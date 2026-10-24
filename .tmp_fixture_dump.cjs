const fs = require('fs')
const f = require('./tests/fixtures/fioni-source-values.json')
console.log('url', f.officialUrl)
console.log('version', f.officialEntryVersion, 'nanoka', f.nanokaVersion)
console.log('nanokaPassive', JSON.stringify(f.nanokaPassive, null, 2).slice(0, 5000))
console.log('cinemaRows', JSON.stringify(f.cinemaRows, null, 2).slice(0, 8000))
for (const tab of f.officialSkillTabs) {
  console.log('TAB', tab.title)
  for (const child of tab.children) {
    console.log('  MOVE', child.title)
    if (child.description) console.log('    DESC', JSON.stringify(child.description).slice(0, 1200))
    const g = child.growth?.[0]
    if (g) console.log('    ROWS', JSON.stringify(g).slice(0, 2000))
  }
}
