const fs = require('fs')
const f = JSON.parse(fs.readFileSync(process.env.TEMP + '/fioni_official.json', 'utf8'))
const page = f.data.page
console.log('page', page.id, page.name)
for (const m of page.modules || []) {
  console.log('MODULE', m.name, 'components', (m.components || []).length)
  for (const c of m.components || []) {
    console.log('  COMP', c.component_id, 'keys', Object.keys(c))
    const d = c.data
    if (typeof d === 'string') console.log('    data head', d.slice(0, 300))
  }
}
