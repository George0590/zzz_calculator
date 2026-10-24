const fs = require('fs')
const f = JSON.parse(fs.readFileSync(process.env.TEMP + '/fioni_official.json', 'utf8'))
const page = f.data.page
for (const m of page.modules || []) {
  for (const c of m.components || []) {
    if (c.component_id !== 'role_talent') continue
    const d = typeof c.data === 'string' ? JSON.parse(c.data) : c.data
    for (const group of d.list || []) {
      for (const child of group.children || []) {
        if (!child.growth) continue
        console.log('===', child.title, 'growth type', typeof child.growth)
        console.log(JSON.stringify(child.growth).slice(0, 3000))
      }
    }
  }
}
