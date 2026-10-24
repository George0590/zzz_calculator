const fs = require('fs')
const f = JSON.parse(fs.readFileSync(process.env.TEMP + '/fioni_official.json', 'utf8'))
const page = f.data.page
const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
for (const m of page.modules || []) {
  for (const c of m.components || []) {
    if (c.component_id !== 'role_talent') continue
    const d = typeof c.data === 'string' ? JSON.parse(c.data) : c.data
    console.log('=== role_talent')
    console.log('top keys', Object.keys(d))
    for (const group of d.list || []) {
      console.log('GROUP', JSON.stringify(group.title), 'keys', Object.keys(group))
      if (group.desc) console.log('  desc', strip(group.desc).slice(0, 500))
      for (const child of group.children || []) {
        console.log('  CHILD', JSON.stringify(child.title), 'keys', Object.keys(child))
        if (child.desc) console.log('    desc', strip(child.desc).slice(0, 2000))
        if (child.table) console.log('    table', JSON.stringify(child.table).slice(0, 2000))
        if (child.list) console.log('    list', JSON.stringify(child.list).slice(0, 2000))
      }
    }
  }
}
