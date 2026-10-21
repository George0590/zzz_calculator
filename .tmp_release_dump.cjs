const fs = require('fs')
const agents = require('./data/agents.json').agents
for (const a of agents) {
  if (Array.isArray(a.anomalyReleaseProfiles)) {
    console.log('===', a.id, a.name.zhCN)
    console.log(JSON.stringify(a.anomalyReleaseProfiles, null, 2))
  }
}
