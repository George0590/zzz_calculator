const fs = require('fs')
const f = JSON.parse(fs.readFileSync(process.env.TEMP + '/fioni_official.json', 'utf8'))
const page = f.data.page
const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
for (const m of page.modules || []) {
  for (const c of m.components || []) {
    if (c.component_id !== 'role_talent') continue
    const d = typeof c.data === 'string' ? JSON.parse(c.data) : c.data
    for (const group of d.list || []) {
      for (const child of group.children || []) {
        if (!child.growth || !Array.isArray(child.growth)) continue
        if (!JSON.stringify(child.growth).includes('生命值')) continue
        console.log('===', child.title)
        for (const g of child.growth) {
          const rows = (g.children || []).flatMap(x => x.row || [])
          console.log('LEVEL', g.name, rows.map(r => r.map(strip).join(' || ')).join(' ### '))
        }
      }
    }
  }
}
