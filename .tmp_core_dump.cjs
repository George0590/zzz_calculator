const f = require('./tests/fixtures/fioni-source-values.json')
const strip = s => String(s).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
for (const tab of f.officialSkillTabs) {
  for (const child of tab.children) {
    if (!child.title.includes('核心')) continue
    console.log('MOVE', child.title)
    console.log('DESC', strip(child.description || '').slice(0, 3000))
    console.log('GROWTH KEYS', Object.keys(child.growth || {}))
    for (const g of child.growth || []) {
      console.log('GROWTH', g.name)
      for (const c of g.children || []) {
        console.log('  ', c.name, JSON.stringify((c.row || []).map(strip)).slice(0, 1500))
      }
    }
  }
}
console.log('=== nanokaPassive levels')
for (const [id, v] of Object.entries(f.nanokaPassive)) {
  console.log(id, v.level, JSON.stringify(v.desc).slice(0, 1200))
}
