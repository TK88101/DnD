const { roll, d20, modifier, attackRoll, proficiencyBonus } = require('./game-engine');

class CombatSession {
  constructor(players, enemies, difficulty) {
    this.players = players.map(p => ({ ...p, side: 'player' }));
    this.enemies = enemies.map(e => ({ ...e, side: 'enemy' }));
    this.difficulty = difficulty || { hpMult: 1, atkMod: 0 };
    this.participants = [];
    this.round = 0;
    this.turnIndex = 0;
    this.isActive = false;
    this.log = [];
    this.dots = [];
    this.summons = [];
    this._lastOptions = null;
  }

  initCombat() {
    // Apply difficulty to enemies
    for (const e of this.enemies) {
      e.maxHp = Math.max(1, Math.floor(e.maxHp * this.difficulty.hpMult));
      e.hp = e.maxHp;
      for (const atk of (e.attacks || [])) {
        atk.bonus = (atk.bonus || 0) + this.difficulty.atkMod;
      }
    }

    // Roll initiative
    const all = [
      ...this.players.map(p => ({ ...p, initiative: d20() + modifier(p.stats.DEX) })),
      ...this.enemies.map(e => ({ ...e, initiative: d20() + 1 })),
    ];

    // Sort: higher first, players win ties
    all.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a.side === 'player' ? -1 : 1;
    });

    this.participants = all;
    this.round = 1;
    this.turnIndex = 0;
    this.isActive = true;

    return { order: all.map(p => ({ name: p.name, initiative: p.initiative, side: p.side })) };
  }

  getCurrentTurn() {
    if (!this.isActive || this.participants.length === 0) return null;
    return this.participants[this.turnIndex];
  }

  advanceTurn() {
    this.turnIndex++;
    if (this.turnIndex >= this.participants.length) {
      this.turnIndex = 0;
      this.round++;
      const dotResults = this.processDOTs();
      if (dotResults.length > 0) this.log.push(...dotResults);
    }
    // Skip dead
    let safety = 0;
    while (this.participants[this.turnIndex] && this.participants[this.turnIndex].hp <= 0 && safety < this.participants.length) {
      this.turnIndex = (this.turnIndex + 1) % this.participants.length;
      safety++;
      if (this.turnIndex === 0) {
        this.round++;
        this.processDOTs();
      }
    }
    return this.getCurrentTurn();
  }

  executeAction(actor, action) {
    const result = { actor: actor.name, effects: [] };

    if (action.type === 'skill') {
      const skill = (actor.skills || []).find(s => s.name === action.skillName);
      if (!skill) return { ...result, action: action.skillName, error: '未知技能', summary: `${actor.name} 嘗試使用未知技能 ${action.skillName}` };

      const target = this.participants.find(p => p.name === action.target && p.hp > 0);
      if (!target && skill.type !== 'summon' && skill.type !== 'buff' && skill.type !== 'defend' && skill.type !== 'stealth' && skill.type !== 'shapeshift' && skill.type !== 'utility') {
        return { ...result, action: skill.name, error: '目標不存在', summary: `找不到目標 ${action.target}` };
      }

      result.action = skill.name;
      result.target = target ? target.name : actor.name;

      // MP check
      if (actor.mp !== undefined && skill.mpCost && actor.mp < skill.mpCost) {
        return { ...result, error: 'MP不足', summary: `${actor.name} 法力不足，無法使用 ${skill.name}（需要 ${skill.mpCost} MP，剩餘 ${actor.mp}）` };
      }

      if (skill.type === 'attack' || skill.type === 'drain') {
        const atkBonus = modifier(actor.stats.INT || 10) + (actor.proficiency || proficiencyBonus(actor.level || 1));
        const atkResult = attackRoll(atkBonus, target.ac);
        result.attackRoll = atkResult;
        result.hit = atkResult.hit;

        if (atkResult.hit) {
          const dmg = roll(skill.damage);
          if (atkResult.crit) { const extra = roll(skill.damage); dmg.total += extra.total; dmg.rolls.push(...extra.rolls); }
          result.damage = { rolls: dmg.rolls, bonus: dmg.bonus, total: dmg.total, type: skill.damageType };
          const before = target.hp;
          target.hp = Math.max(0, target.hp - dmg.total);
          result.targetHp = { before, after: target.hp, max: target.maxHp };

          if (skill.type === 'drain') {
            const healAmt = Math.min(dmg.total, actor.maxHp - actor.hp);
            actor.hp += healAmt;
            result.effects.push({ type: 'heal', target: actor.name, amount: healAmt });
          }
        }

        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);

      } else if (skill.type === 'dot') {
        result.hit = true;
        this.dots.push({
          source: actor.name, target: target.name,
          damage: skill.damage, damageType: skill.damageType,
          remaining: skill.duration,
        });
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);
        result.damage = { total: 0, type: skill.damageType };
        result.targetHp = { before: target.hp, after: target.hp, max: target.maxHp };

      } else if (skill.type === 'heal') {
        const healTarget = target || actor;
        const healRoll = roll(skill.damage);
        const wisMod = modifier(actor.stats.WIS || 10);
        healRoll.total += wisMod;
        const before = healTarget.hp;
        healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healRoll.total);
        result.hit = true;
        result.target = healTarget.name;
        result.damage = { total: healTarget.hp - before, type: 'heal' };
        result.targetHp = { before, after: healTarget.hp, max: healTarget.maxHp };
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);

      } else if (skill.type === 'hot') {
        result.hit = true;
        const hotTarget = target || actor;
        this.dots.push({
          source: actor.name, target: hotTarget.name,
          damage: skill.damage, damageType: 'heal',
          remaining: skill.duration, isHeal: true,
        });
        result.target = hotTarget.name;
        result.damage = { total: 0, type: 'heal' };
        result.targetHp = { before: hotTarget.hp, after: hotTarget.hp, max: hotTarget.maxHp };
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);

      } else if (skill.type === 'summon') {
        result.hit = true;
        result.target = skill.summonId;
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);
        // Summon handling done externally

      } else if (skill.type === 'cc') {
        result.hit = true;
        if (target) {
          result.target = target.name;
          result.effects.push({ type: 'cc', target: target.name, duration: skill.duration, ccType: skill.immuneCheck || 'stun' });
        }
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);
        result.damage = { total: 0, type: 'cc' };
        result.targetHp = target ? { before: target.hp, after: target.hp, max: target.maxHp } : null;

      } else {
        // buff, defend, stealth, shapeshift, utility, etc
        result.hit = true;
        result.target = actor.name;
        result.damage = { total: 0, type: 'utility' };
        if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);
      }

      result.summary = this.buildSummary(result, skill);

    } else if (action.type === 'melee') {
      const target = this.participants.find(p => p.name === action.target && p.hp > 0);
      if (!target) return { ...result, action: '近戰', error: '目標不存在', summary: `找不到目標` };

      result.action = actor.equipment?.weapon?.name || '近戰攻擊';
      result.target = target.name;

      const statKey = actor.equipment?.weapon?.stat === 'INT' ? 'INT' : actor.equipment?.weapon?.stat === 'DEX' ? 'DEX' : 'STR';
      const statMod = modifier(actor.stats?.[statKey] || 10);
      const prof = actor.proficiency || proficiencyBonus(actor.level || 1);
      const atkResult = attackRoll(statMod + prof, target.ac);
      result.attackRoll = atkResult;
      result.hit = atkResult.hit;

      if (atkResult.hit) {
        const weaponDmg = actor.equipment?.weapon?.damage || '1d4';
        const dmg = roll(weaponDmg);
        dmg.total = Math.max(1, dmg.total + statMod);
        if (atkResult.crit) { const extra = roll(weaponDmg); dmg.total += extra.total; }
        result.damage = { rolls: dmg.rolls, bonus: statMod, total: dmg.total, type: '物理' };
        const before = target.hp;
        target.hp = Math.max(0, target.hp - dmg.total);
        result.targetHp = { before, after: target.hp, max: target.maxHp };
      }

      result.summary = this.buildSummary(result);

    } else if (action.type === 'item') {
      result.action = action.itemName || '物品';
      if (/治療藥水/.test(action.itemName)) {
        const healRoll = roll('2d4+2');
        const before = actor.hp;
        actor.hp = Math.min(actor.maxHp, actor.hp + healRoll.total);
        result.effects.push({ type: 'heal', target: actor.name, amount: actor.hp - before });
        result.summary = `${actor.name} 使用 ${action.itemName}，恢復 ${actor.hp - before} HP（${before}→${actor.hp}）`;
      } else {
        result.summary = `${actor.name} 使用了 ${action.itemName}`;
      }

    } else if (action.type === 'flee') {
      result.action = '逃跑';
      const check = d20() + modifier(actor.stats?.DEX || 10);
      result.hit = check >= 12;
      result.summary = result.hit ? `${actor.name} 成功逃離了戰鬥！` : `${actor.name} 逃跑失敗！`;
      if (result.hit) this.isActive = false;
    }

    this.log.push(result);
    return result;
  }

  executeMonsterAI(monster) {
    // Simple AI: attack lowest HP player
    const targets = this.participants.filter(p => p.side === 'player' && p.hp > 0);
    if (targets.length === 0) return { actor: monster.name, action: '無行動', summary: '沒有可攻擊的目標', effects: [] };

    const target = targets.reduce((a, b) => a.hp < b.hp ? a : b);
    const attack = (monster.attacks || [])[0];
    if (!attack) return { actor: monster.name, action: '無行動', summary: `${monster.name} 無法攻擊`, effects: [] };

    const atkResult = attackRoll(attack.bonus || 0, target.ac);
    const result = { actor: monster.name, action: attack.name, target: target.name, attackRoll: atkResult, hit: atkResult.hit, effects: [] };

    if (atkResult.hit) {
      const dmg = roll(attack.damage);
      if (atkResult.crit) { const extra = roll(attack.damage); dmg.total += extra.total; dmg.rolls.push(...extra.rolls); }
      result.damage = { rolls: dmg.rolls, bonus: 0, total: dmg.total, type: attack.damageType || '物理' };
      const before = target.hp;
      target.hp = Math.max(0, target.hp - dmg.total);
      result.targetHp = { before, after: target.hp, max: target.maxHp };
    }

    result.summary = this.buildSummary(result);
    this.log.push(result);
    return result;
  }

  executeSummonAI(summon) {
    const enemies = this.participants.filter(p => p.side === 'enemy' && p.hp > 0);
    if (enemies.length === 0) return { actor: summon.name, action: '無行動', summary: '沒有敵人', effects: [] };

    let target;
    if (summon.ai === 'tank') {
      target = enemies[0];
    } else {
      target = enemies.reduce((a, b) => a.hp < b.hp ? a : b);
    }

    const atk = summon.attack;
    const atkResult = attackRoll(atk.bonus || 0, target.ac);
    const result = { actor: summon.name, action: atk.name, target: target.name, attackRoll: atkResult, hit: atkResult.hit, effects: [] };

    if (atkResult.hit) {
      const dmg = roll(atk.damage);
      if (atkResult.crit) { const extra = roll(atk.damage); dmg.total += extra.total; }
      result.damage = { rolls: dmg.rolls, bonus: 0, total: dmg.total, type: atk.damageType || '物理' };
      const before = target.hp;
      target.hp = Math.max(0, target.hp - dmg.total);
      result.targetHp = { before, after: target.hp, max: target.maxHp };
    }

    result.summary = this.buildSummary(result);
    this.log.push(result);
    return result;
  }

  processDOTs() {
    const results = [];
    this.dots = this.dots.filter(dot => {
      const target = this.participants.find(p => p.name === dot.target);
      if (!target || target.hp <= 0) return false;

      const dmg = roll(dot.damage);
      const before = target.hp;

      if (dot.isHeal) {
        target.hp = Math.min(target.maxHp, target.hp + dmg.total);
        results.push({
          actor: dot.source, action: 'HOT', target: dot.target,
          damage: { total: target.hp - before, type: 'heal' },
          summary: `${dot.source} 的持續治療恢復 ${dot.target} ${target.hp - before} HP（${before}→${target.hp}）`,
          effects: []
        });
      } else {
        target.hp = Math.max(0, target.hp - dmg.total);
        results.push({
          actor: dot.source, action: 'DOT', target: dot.target,
          damage: { total: dmg.total, type: dot.damageType },
          targetHp: { before, after: target.hp, max: target.maxHp },
          summary: `${dot.source} 的${dot.damageType}持續傷害對 ${dot.target} 造成 ${dmg.total} 點傷害（HP ${before}→${target.hp}）`,
          effects: []
        });
      }

      dot.remaining--;
      return dot.remaining > 0;
    });
    return results;
  }

  checkCombatEnd() {
    const playersAlive = this.participants.filter(p => p.side === 'player' && p.hp > 0);
    const enemiesAlive = this.participants.filter(p => p.side === 'enemy' && p.hp > 0);

    if (enemiesAlive.length === 0) {
      this.isActive = false;
      const loot = this.generateLoot();
      return { ended: true, result: 'victory', loot };
    }
    if (playersAlive.length === 0) {
      this.isActive = false;
      return { ended: true, result: 'defeat' };
    }
    return { ended: false };
  }

  generateLoot() {
    const deadEnemies = this.participants.filter(p => p.side === 'enemy' && p.hp <= 0);
    const loot = { items: [], gold: 0, exp: 0 };

    for (const enemy of deadEnemies) {
      loot.exp += enemy.exp || 0;
      for (const item of (enemy.loot || [])) {
        const chance = Math.floor(Math.random() * 100) + 1;
        if (chance <= item.weight) {
          loot.items.push({ name: item.name, price: item.price });
        }
      }
    }

    return loot;
  }

  getAvailableActions(participant) {
    const actions = [];
    const enemies = this.participants.filter(p => p.side === 'enemy' && p.hp > 0);
    const allies = this.participants.filter(p => p.side === 'player' && p.hp > 0);
    const enemyNames = enemies.map(p => p.name);
    const allyNames = allies.map(p => p.name);

    for (const skill of (participant.skills || [])) {
      if (participant.mp !== undefined && skill.mpCost && participant.mp < skill.mpCost) continue;
      let targets;
      if (skill.type === 'heal' || skill.type === 'hot' || skill.type === 'shield' || skill.type === 'resurrect') {
        targets = allyNames;
      } else if (skill.type === 'buff' || skill.type === 'defend' || skill.type === 'stealth' || skill.type === 'shapeshift' || skill.type === 'utility') {
        targets = [participant.name];
      } else if (skill.type === 'summon') {
        targets = [skill.summonId];
      } else if (skill.target === 'all_enemies') {
        targets = ['全體敵人'];
      } else if (skill.target === 'party') {
        targets = ['全體隊友'];
      } else {
        targets = enemyNames;
      }
      actions.push({ type: 'skill', skillName: skill.name, targets, mpCost: skill.mpCost, desc: skill.name });
    }

    // Melee weapon
    actions.push({ type: 'melee', targets: enemyNames, desc: participant.equipment?.weapon?.name || '近戰攻擊' });
    actions.push({ type: 'item', targets: [], desc: '使用物品' });
    actions.push({ type: 'flee', targets: [], desc: '逃跑' });

    return actions;
  }

  buildSummary(result, skill) {
    if (result.error) return result.summary || `${result.actor}: ${result.error}`;

    if (skill && skill.type === 'dot') {
      return `${result.actor} 對 ${result.target} 施放 ${result.action}（${skill.duration} 回合 ${skill.damageType} DOT）`;
    }
    if (skill && skill.type === 'heal') {
      return `${result.actor} 用 ${result.action} 治療 ${result.target}，恢復 ${result.damage.total} HP（${result.targetHp.before}→${result.targetHp.after}）`;
    }
    if (skill && skill.type === 'hot') {
      return `${result.actor} 對 ${result.target} 施放 ${result.action}（${skill.duration} 回合持續治療）`;
    }
    if (skill && (skill.type === 'cc')) {
      return `${result.actor} 對 ${result.target} 施放 ${result.action}（控制 ${skill.duration} 回合）`;
    }
    if (skill && (skill.type === 'summon')) {
      return `${result.actor} 召喚了 ${skill.desc}！`;
    }
    if (skill && (skill.type === 'buff' || skill.type === 'defend' || skill.type === 'stealth' || skill.type === 'shapeshift' || skill.type === 'utility')) {
      return `${result.actor} 使用了 ${result.action}`;
    }

    if (!result.hit && result.attackRoll) {
      return `${result.actor} 的 ${result.action} 未命中 ${result.target}（${result.attackRoll.str}）`;
    }
    if (result.hit && result.damage) {
      const killText = result.targetHp?.after <= 0 ? '，擊殺！' : '';
      return `${result.actor} 用 ${result.action} 命中 ${result.target}，造成 ${result.damage.total} 點${result.damage.type}傷害（HP ${result.targetHp.before}→${result.targetHp.after}）${killText}`;
    }
    return `${result.actor} 使用了 ${result.action}`;
  }

  // Static difficulty table (mirrors relay.js getDifficulty)
  static getDifficulty(playerCount) {
    const table = {
      1: { hpMult: 0.5, atkMod: -2 },
      2: { hpMult: 0.8, atkMod: -1 },
      3: { hpMult: 1.0, atkMod: 0 },
      4: { hpMult: 1.3, atkMod: 1 },
      5: { hpMult: 1.6, atkMod: 2 },
      6: { hpMult: 2.0, atkMod: 3 },
      7: { hpMult: 2.5, atkMod: 3 },
      8: { hpMult: 3.0, atkMod: 4 },
    };
    return table[Math.min(Math.max(playerCount, 1), 8)];
  }
}

// === Encounter Generator ===

class EncounterGenerator {
  constructor(monsterDb) {
    this.monsterDb = monsterDb;
  }

  generateRandom(areaLevel, playerCount) {
    const candidates = [];
    for (const [name, template] of this.monsterDb) {
      if (template.levelRange && template.levelRange[0] <= areaLevel + 1 && template.levelRange[1] >= areaLevel - 1) {
        candidates.push(template);
      }
    }
    if (candidates.length === 0) return [];

    const count = Math.min(Math.floor(Math.random() * 3) + 1, candidates.length);
    const enemies = [];
    for (let i = 0; i < count; i++) {
      const template = candidates[Math.floor(Math.random() * candidates.length)];
      const instance = this.instantiate(template);
      instance.name = count > 1 ? `${template.name}${String.fromCharCode(65 + i)}` : template.name;
      enemies.push(instance);
    }
    return enemies;
  }

  instantiate(template) {
    const hpRoll = roll(template.hp);
    return {
      name: template.name,
      type: 'enemy',
      enemyType: template.type,
      hp: hpRoll.total,
      maxHp: hpRoll.total,
      ac: template.ac,
      attacks: (template.attacks || []).map(a => ({ ...a })),
      special: template.special || [],
      loot: template.loot || [],
      exp: template.exp || 0,
    };
  }

  aggroCheck() {
    return d20() > 10;
  }
}

module.exports = { CombatSession, EncounterGenerator };
