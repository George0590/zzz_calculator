const fs = require('fs')
const a = require('./data/agent_skills.json').agentSkills.find(x => x.id === 'fioni')
const lines = []
for (const c of a.categories) {
  lines.push(`## ${c.id} ${c.name.zhCN} ${JSON.stringify(c.levelRange)}`)
  for (const m of c.moves) {
    lines.push(`  - ${m.id} | ${m.name.zhCN} | tags=${JSON.stringify(m.skillTags)}`)
    for (const r of m.rows) {
      lines.push(`      * ${r.id} | ${r.kind} | ${r.label.zhCN} | ${JSON.stringify(r.values)} | ${r.damageBasis || ''}`)
    }
  }
}
fs.writeFileSync(process.env.TEMP + '/fioni_summary.txt', lines.join('\n'), 'utf8')
console.log('lines', lines.length)
