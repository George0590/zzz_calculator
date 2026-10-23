const fs = require('fs')
const f = JSON.parse(fs.readFileSync(process.env.TEMP + '/fioni_official.json', 'utf8'))
const s = JSON.stringify(f)
for (const key of ['生命值', '基础攻击力', '基础防御力', '异常掌控', '异常精通', '冲击力', '能量自动回复']) {
  const idx = s.indexOf(key)
  console.log(key, idx)
  if (idx >= 0) console.log(s.slice(Math.max(0, idx - 300), idx + 800).replace(/\\u003c/g, '<'))
}
