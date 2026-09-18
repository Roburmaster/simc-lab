export const classes = ['deathknight','demonhunter','druid','evoker','hunter','mage','monk','paladin','priest','rogue','shaman','warlock','warrior'];
export const slots = ['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet','finger1','finger2','trinket1','trinket2','main_hand','off_hand'];
const fields = new Set([...classes,...slots,'level','race','role','position','spec','talents','class_talents','spec_talents','hero_talents','omnium_talents','professions','name','source','origin','region','server','thumbnail','potion','flask','food','augmentation','temporary_enchant','renown','covenant','soulbind','soulbinds','azerite_essences','zandalari_loa']);
// Import data, never SimC file/output/network directives. Unknown directives fail visibly.
export function parseProfile(input, { override = false } = {}) {
  if (typeof input !== 'string' || input.length > 250000) throw new Error('The profile must be text under 250 kB.');
  const lines = []; const gear = {}; const info = {}; const warnings = []; let actors = 0;
  for (const [index, raw] of input.replace(/^\uFEFF/,'').split(/\r?\n/).entries()) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-zA-Z_][\w.]*(?:\+)?)=(.*)$/);
    if (!match || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line)) throw new Error(`Invalid SimC line ${index + 1}.`);
    let [,key,value] = match; key = ({shoulders:'shoulder',wrists:'wrist'}[key] || key); line = key + '=' + value; const base = key.replace(/\+$/,'');
    if (!fields.has(base) && !/^actions(?:\.[a-zA-Z_][\w]*)?$/.test(base)) throw new Error(`Line ${index + 1}: «${key}» is not supported in profile imports. Use simulation settings for run options.`);
    if (!/^(?:"[^"\r\n]*"|[^\s"]*)$/.test(value)) throw new Error(`Line ${index + 1}: use one SimC setting per line.`);
    if (classes.includes(key)) { actors++; info.class = key; info.name = value.replace(/^"|"$/g,''); if (override) throw new Error('A variant cannot create another character.'); }
    if (['level','race','spec','talents','role'].includes(key)) info[key] = value;
    if (slots.includes(key)) {
      const id = value.match(/(?:^|,)id=(\d+)/)?.[1];
      if (!id && value !== 'none') throw new Error(`Gear in ${key} is missing an item ID.`);
      gear[key] = {slot:key, value, id:Number(id || 0), enchantId:Number(value.match(/(?:^|,)enchant_id=(\d+)/)?.[1] || 0)};
    }
    // Informational addon fields do not affect the simulation.
    if (['source','origin','thumbnail','region','server'].includes(key)) continue;
    lines.push(line);
  }
  if (!override && actors !== 1) throw new Error('Paste one complete character from /simc.');
  if (!override && !info.spec) throw new Error('The profile is missing spec=.');
  if (!override && !Object.keys(gear).length) throw new Error('The profile is missing gear.');
  const version = input.match(/(?:WoW|WOW|wow)[^\r\n]*?\b(\d{2}\.\d+\.\d+)(?:[. ]+|\s*\()?(\d{5})?/);
  if (!version && !override) warnings.push('No readable WoW version in the addon export. The installed version is checked before running.');
  return {alternatives: readAlternativees(input), text:lines.join('\n'), gear, info, warnings, version:version ? {patch:version[1],build:version[2] || null} : null};
}
export function replaceEnchant(value, id) {
  return value.split(',').filter(v=>!/^enchant(?:_id)?=/.test(v)).join(',') + (id ? `,enchant_id=${id}` : '');
}
export function applyOverrides(base, overrides) {
  let lines = base.split('\n');
  for (const line of overrides.split('\n').filter(Boolean)) {
    const key = line.slice(0,line.indexOf('='));
    if (!key.endsWith('+')) lines = lines.filter(v=>v.slice(0,v.indexOf('=')) !== key);
    lines.push(line);
  }
  return lines.join('\n');
}
export function createVariants(profile, request, catalog) {
  const mode = request.mode || 'quick';
  const variants = [{name:'Current gear',text:profile.text,baseline:true}];
  if (mode === 'enchants') {
    const selections = Object.entries(request.enchants || {}).filter(([,ids])=>Array.isArray(ids) && ids.length);
    if (!selections.length) throw new Error('Select at least one enchant to compare.');
    const groups = selections.map(([slot,rawIds])=>{
      if (!profile.gear[slot]) throw new Error(`The profile is missing ${slot}.`);
      const compatible = catalog.forItem(profile.gear[slot].id, profile.info.class);
      return [...new Set(rawIds.map(Number))].map(id=>{
        const enchant = compatible.find(e=>e.id===id);
        if (id !== 0 && !enchant) throw new Error(`Enchant ${id} is not compatible with ${slot}.`);
        return {name:`${slot}: ${enchant?.label || 'No enchant'}`,line:`${slot}=${replaceEnchant(profile.gear[slot].value,id)}`};
      });
    });
    let combinations = request.combine ? [{name:'',lines:[]}] : [];
    if (request.combine) for (const group of groups) {
      if (combinations.length * group.length > 128) throw new Error('Maximum 128 enchant combinations per job.');
      combinations = combinations.flatMap(c=>group.map(v=>({name:c.name ? `${c.name} + ${v.name}` : v.name,lines:[...c.lines,v.line]})));
    } else combinations = groups.flat().map(v=>({name:v.name,lines:[v.line]}));
    for (const c of combinations) variants.push({name:c.name,text:applyOverrides(profile.text,c.lines.join('\n'))});
  } else if (mode === 'compare') {
    if (!Array.isArray(request.variants) || !request.variants.length) throw new Error('Add at least one variant.');
    for (const v of request.variants) {
      if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 160) throw new Error('Variant names must contain 1–160 characters.');
      const patch = parseProfile(v.text,{override:true});
      catalog.validateChanges(profile,patch);
      if (!patch.text) throw new Error(`Variant «${v.name}» is empty.`);
      variants.push({name:v.name,text:applyOverrides(profile.text,patch.text)});
    }
  } else if (mode !== 'quick') throw new Error('Unknown simulation mode.');
  if (variants.length > 129) throw new Error('Too many variants.');
  return variants;
}

// Bag / vault items and saved talents are comments in the addon export.
function readAlternativees(input) {
  const results=[]; const seen=new Set(); let label=''; let section='';
  for(const raw of input.split(/\r?\n/)) {
    const line=raw.trim();
    if(line.startsWith('###')) {section=line.replace(/^#+\s*/,'');label='';continue;}
    const comment=line.match(/^#\s*(.*)$/)?.[1]; if(comment===undefined)continue;
    const match=comment.match(/^([a-z_][a-z0-9_]*)=(.+)$/);
    if(match) {
      const key=({shoulders:'shoulder',wrists:'wrist'}[match[1]] || match[1]);
      if((slots.includes(key)||key==='talents') && !seen.has(comment)) {
        results.push({name:label||key,text:key+'='+match[2],slot:slots.includes(key)?key:null,section});seen.add(comment);
      }
    } else if(comment && !comment.startsWith('Upgrade') && !comment.startsWith('Item Level')) label=comment.replace(/^Saved Loadout:\s*/, '');
  }
  return results.slice(0,500);
}