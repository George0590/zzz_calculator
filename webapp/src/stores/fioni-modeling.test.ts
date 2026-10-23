import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { useBuildStore } from './build'
import { prepareDraft } from '@/components/maintenance/maintenance-model'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const read=(name:string)=>JSON.parse(readFileSync(path.join(root,'data',name+'.json'),'utf8'))
const agent=read('agents').agents.find((a:any)=>a.id==='fioni'),skills=read('agent_skills').agentSkills.find((a:any)=>a.id==='fioni')
const engine=read('w_engines').wEngines.find((a:any)=>a.id==='zzz_wiki_154')
const meta={agents:[agent],agentSkills:[skills],wEngines:[engine],combatBuffs:[]}
beforeEach(()=>{setActivePinia(createPinia());localStorage.clear()})
it('initializes one Fire release at C0/F/Lv12 and preserves custom C4 through reload',async()=>{
 const store=useBuildStore();store.initialize({},meta)
 expect(store.coreSkillLevel).toBe('F');expect(store.cinemaLevel).toBe(0);expect(store.skillLevels.basic).toBe(12)
 expect(store.damageConfig.events).toHaveLength(1)
 expect(store.damageConfig.events[0]).toMatchObject({settlementType:'release',anomalyEffect:'burn',releaseSkillRef:{categoryId:'basic'}})
 expect(store.activeBuffIds(meta)).toContain('agent:fioni.additionalAbility')
 expect(store.activeBuffIds(meta)).toContain('agent:fioni.skill.release_crit_dmg')
 store.setCinemaLevel(4,meta)
 expect(store.skillLevels.basic).toBe(14)
 const event={...store.damageConfig.events[0],anomalyEffect:'shock',critMode:'crit',triggerActorRef:{agentId:'fioni',profileId:'fioni_c4_extra_release'}}
 store.setDamageConfig({...store.damageConfig,mode:'custom',events:[event]},agent)
 await store.persist();setActivePinia(createPinia());const restored=useBuildStore();restored.initialize({},meta)
 expect(restored.damageConfig.events[0].triggerActorRef.profileId).toBe('fioni_c4_extra_release')
 expect(restored.damageConfig.events[0].anomalyEffect).toBe('shock')
 expect(restored.damageConfig.events[0].releaseSkillRef).toBeUndefined()
 expect(restored.damageConfig.events[0].critMode).toBe('crit')
})
it('keeps initial-mastery formula targets, profile bindings and exact Core fractions during maintenance',()=>{
 const draft=prepareDraft('agents',agent)
 expect(draft.combatBuffs.corePassive.effects.filter((r:any)=>r.type==='formula').map((r:any)=>r.target.settlementTypes)).toEqual([['attribute','turbulence','release']])
 expect(draft.anomalyReleaseProfiles).toEqual(agent.anomalyReleaseProfiles)
 expect(draft.coreSkill.corePassiveScaling.levels[1].searAnomalyCritDmgPct).toBe(12.5+12.5/6)
})
