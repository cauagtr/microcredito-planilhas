export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabase, BUCKET_NAME, GENERATED_FOLDER } from '@/lib/supabase'
import { processarPlanilhas } from '@/lib/processador'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ts, hasAnterior } = body

    if (!ts) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
    }

    const downloadTemp = async (suffix: string): Promise<Buffer> => {
      const path = `temp/${ts}_${suffix}`
      const { data, error } = await supabase.storage.from(BUCKET_NAME).download(path)
      if (error || !data) throw new Error(`Erro ao ler arquivo ${suffix}: ${error?.message}`)
      return Buffer.from(await data.arrayBuffer())
    }

    const finalizadosBuffer = await downloadTemp('finalizados')
    const andamentoBuffer = await downloadTemp('andamento')

    let anteriorBuffer: Buffer

    if (hasAnterior) {
      anteriorBuffer = await downloadTemp('anterior')
    } else {
      const { data: files, error: listError } = await supabase.storage
        .from(BUCKET_NAME)
        .list(GENERATED_FOLDER, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

      if (listError || !files || files.length === 0) {
        return NextResponse.json({ error: 'Nenhuma planilha anterior encontrada. Envie manualmente.' }, { status: 400 })
      }

      const validFiles = files.filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
      if (validFiles.length === 0) {
        return NextResponse.json({ error: 'Nenhuma planilha anterior encontrada. Envie manualmente.' }, { status: 400 })
      }

      const { data: fileData, error: downloadError } = await supabase.storage
        .from(BUCKET_NAME)
        .download(`${GENERATED_FOLDER}/${validFiles[0].name}`)

      if (downloadError || !fileData) {
        return NextResponse.json({ error: 'Erro ao baixar planilha anterior.' }, { status: 500 })
      }
      anteriorBuffer = Buffer.from(await fileData.arrayBuffer())
    }

    const { fileBuffer, fileName } = await processarPlanilhas({ finalizadosBuffer, andamentoBuffer, anteriorBuffer })

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(`${GENERATED_FOLDER}/${fileName}`, new Uint8Array(fileBuffer), {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: `Erro ao salvar: ${uploadError.message}` }, { status: 500 })
    }

    await supabase.storage.from(BUCKET_NAME).remove([
      `temp/${ts}_finalizados`,
      `temp/${ts}_andamento`,
      `temp/${ts}_anterior`,
    ])

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(`${GENERATED_FOLDER}/${fileName}`)

    return NextResponse.json({ success: true, fileName, downloadUrl: urlData.publicUrl })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno.'
    return NextResponse.json({ error: `Erro: ${message}` }, { status: 500 })
  }
}
