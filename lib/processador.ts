import ExcelJS from 'exceljs'

const COLLABORATOR_COLORS: Record<string, string> = {
  "ANDRESSA": "E06C75",
  "ANNA":     "C9A0DC",
  "CAUA":     "F4A460",
  "CONRADO":  "E88080",
  "JULIANO":  "93C47D",
  "LETICIA":  "EA9999",
  "MARCOS":   "6FA8DC",
  "PEDRO":    "9FC5E8",
  "RAIANE":   "D5A6E6",
  "VALERIO":  "FFFFFF",
}

function normalizeStr(s: unknown): string {
  if (!s) return ''
  return String(s).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function findColIndex(headers: string[], name: string): number {
  const norm = normalizeStr(name)
  return headers.findIndex(h => normalizeStr(h) === norm)
}

async function parseBuffer(buffer: Buffer): Promise<{ headers: string[]; rows: unknown[][] }> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    const csvWorkbook = new ExcelJS.Workbook()
    const { PassThrough } = await import('stream')
    const readable = new PassThrough()
    readable.end(buffer)
    await csvWorkbook.csv.read(readable)
    const sheet = csvWorkbook.worksheets[0]
    if (!sheet) return { headers: [], rows: [] }
    const data: unknown[][] = []
    sheet.eachRow(row => { data.push((row.values as unknown[]).slice(1)) })
    if (data.length === 0) return { headers: [], rows: [] }
    return {
      headers: (data[0] as unknown[]).map(h => h ? String(h).trim() : ''),
      rows: data.slice(1),
    }
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) return { headers: [], rows: [] }
  const data: unknown[][] = []
  sheet.eachRow(row => { data.push((row.values as unknown[]).slice(1)) })
  if (data.length === 0) return { headers: [], rows: [] }
  return {
    headers: (data[0] as unknown[]).map(h => h ? String(h).trim() : ''),
    rows: data.slice(1),
  }
}

function processColumns(headers: string[], rows: unknown[][]): { headers: string[]; rows: unknown[][] } {
  let h = [...headers]
  let r = rows.map(row => [...row])

  h.splice(0, 5)
  r = r.map(row => { row.splice(0, 5); return row })

  if (h.length > 4) { h.splice(4, 2); r = r.map(row => { row.splice(4, 2); return row }) }
  if (h.length > 6) { h.splice(6); r = r.map(row => { row.splice(6); return row }) }

  while (h.length < 6) h.push('')
  r = r.map(row => { while (row.length < 6) row.push(''); return row })

  const colC_h = h.splice(2, 1)[0]
  const colC_r = r.map(row => row.splice(2, 1)[0])
  h.splice(1, 0, colC_h)
  r = r.map((row, i) => { row.splice(1, 0, colC_r[i]); return row })

  const colF_h = h.splice(5, 1)[0]
  const colF_r = r.map(row => row.splice(5, 1)[0])
  h.splice(3, 0, colF_h)
  r = r.map((row, i) => { row.splice(3, 0, colF_r[i]); return row })

  const colA_h = h.splice(0, 1)[0]
  const colA_r = r.map(row => row.splice(0, 1)[0])
  h.splice(4, 0, colA_h)
  r = r.map((row, i) => { row.splice(4, 0, colA_r[i]); return row })

  return { headers: h, rows: r }
}

function filterFinalizados(headers: string[], rows: unknown[][]): unknown[][] {
  const etapaNames = ['ETAPA', 'NA ETAPA', 'STATUS']
  const dateNames = ['NA ETAPA DESDE', 'ETAPA DESDE', 'DATA ETAPA', 'DATA']
  let etapaIdx = -1, dateIdx = -1
  for (const n of etapaNames) { const i = findColIndex(headers, n); if (i !== -1) { etapaIdx = i; break } }
  for (const n of dateNames) { const i = findColIndex(headers, n); if (i !== -1) { dateIdx = i; break } }
  const validEtapas = ['CONCEDIDO', 'EXCLUIDO', 'RECUSADO']
  const today = new Date()
  const lastMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1
  const lastMonthYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear()
  return rows.filter(row => {
    if (etapaIdx !== -1 && !validEtapas.includes(normalizeStr(row[etapaIdx]))) return false
    if (dateIdx !== -1 && row[dateIdx]) {
      const d = row[dateIdx] instanceof Date ? row[dateIdx] as Date : new Date(String(row[dateIdx]))
      if (!isNaN(d.getTime()) && (d.getMonth() !== lastMonth || d.getFullYear() !== lastMonthYear)) return false
    }
    return true
  })
}

function buildLookupMap(rows: unknown[][], keyIdx: number, valueIdx: number): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const row of rows) {
    const key = normalizeStr(row[keyIdx])
    if (key && !map.has(key)) map.set(key, row[valueIdx] ?? '')
  }
  return map
}

export interface ProcessInput {
  finalizadosBuffer: Buffer
  andamentoBuffer: Buffer
  anteriorBuffer: Buffer
}

export interface ProcessResult {
  fileBuffer: Buffer
  fileName: string
}

export async function processarPlanilhas(input: ProcessInput): Promise<ProcessResult> {
  const finalizados = await parseBuffer(input.finalizadosBuffer)
  const andamento = await parseBuffer(input.andamentoBuffer)
  const anterior = await parseBuffer(input.anteriorBuffer)

  const andamentoProc = processColumns(andamento.headers, andamento.rows)
  const finalizadosProc = processColumns(finalizados.headers, finalizados.rows)
  const finalizadosFilt = filterFinalizados(finalizadosProc.headers, finalizadosProc.rows)

  const obsAntIdx = findColIndex(anterior.headers, 'OBSERVACAO ANTERIOR')
  const obsIdx = findColIndex(anterior.headers, 'OBSERVACAO')
  if (obsAntIdx !== -1 && obsIdx !== -1) {
    for (const row of anterior.rows) row[obsIdx] = row[obsAntIdx]
  }

  const finalHeaders = [...andamentoProc.headers]
  while (finalHeaders.length < 10) finalHeaders.push('')

  const finalRows = [...andamentoProc.rows, ...finalizadosFilt].map(row => {
    const r = [...row]
    while (r.length < 10) r.push('')
    return r
  })

  const colBIdx = 1, colHIdx = 7, colJIdx = 9
  const anteriorBIdx = Math.min(1, anterior.headers.length - 1)
  const anteriorHIdx = findColIndex(anterior.headers, 'OBSERVACAO ANTERIOR') !== -1 ? findColIndex(anterior.headers, 'OBSERVACAO ANTERIOR') : Math.min(7, anterior.headers.length - 1)
  const anteriorJIdx = findColIndex(anterior.headers, 'RESPONSAVEL') !== -1 ? findColIndex(anterior.headers, 'RESPONSAVEL') : Math.min(9, anterior.headers.length - 1)

  const lookupH = buildLookupMap(anterior.rows, anteriorBIdx, anteriorHIdx)
  const lookupJ = buildLookupMap(anterior.rows, anteriorBIdx, anteriorJIdx)

  for (const row of finalRows) {
    const key = normalizeStr(row[colBIdx])
    row[colHIdx] = lookupH.has(key) ? lookupH.get(key) : 'N/A'
    row[colJIdx] = lookupJ.has(key) ? lookupJ.get(key) : 'N/A'
  }

  const tipoIdx = ['TIPO', 'PRODUTO', 'PROPOSTA', 'MODALIDADE'].reduce((f, n) => f !== -1 ? f : findColIndex(finalHeaders, n), -1)
  const sistemaIdx = findColIndex(finalHeaders, 'SISTEMA')
  const microTypes = ['MICROCREDITO', 'PRE-PROPOSTA MICROCREDITO', 'MENSAGENS', 'PESQUISA DE PROJETOS']

  for (const row of finalRows) {
    if (normalizeStr(row[colJIdx]) === '' || normalizeStr(row[colJIdx]) === 'N/A') {
      if (tipoIdx !== -1 && microTypes.includes(normalizeStr(row[tipoIdx])) && (sistemaIdx === -1 || normalizeStr(row[sistemaIdx]) === 'INFORMATICA')) {
        row[colJIdx] = 'MARCOS'
      }
    }
  }

  for (const row of finalRows) row[0] = row[colJIdx]

  const workbook = new ExcelJS.Workbook()
  const today = new Date()
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const yyyy = today.getFullYear()
  const HH = String(today.getHours()).padStart(2, '0')
  const MIN = String(today.getMinutes()).padStart(2, '0')
  const fileName = `planilha_${dd}-${mm}-${yyyy}_${HH}-${MIN}.xlsx`

  const worksheet = workbook.addWorksheet(`${dd}/${mm}/${yyyy}`)
  worksheet.addRow(finalHeaders)

  const headerRow = worksheet.getRow(1)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003366' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 20

  for (const rowData of finalRows) {
    const row = worksheet.addRow(rowData)
    const color = COLLABORATOR_COLORS[normalizeStr(rowData[colJIdx])]
    if (color) {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } }
      })
    }
  }

  worksheet.columns.forEach(col => { col.width = 20 })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return { fileBuffer: Buffer.from(arrayBuffer), fileName }
}
