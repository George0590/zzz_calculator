const agents = require('./data/agents.json').agents
for (const id of ['nangongyu', 'vivian', 'velina', 'aria', 'pyrois']) {
  const a = agents.find(x => x.id === id)
  console.log('=====', id, a.name.zhCN)
  console.log(JSON.stringify(a.combatBuffs, null, 2).slice(0, 12000))
}
