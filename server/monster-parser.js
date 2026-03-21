const fs = require('fs');
const path = require('path');

const GAME_DIR = path.join(__dirname, '..');

function parseEnemyBlock(block) {
  const enemy = { attacks: [], special: [], loot: [] };

  const field = (label) => {
    const re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|`);
    const m = block.match(re);
    return m ? m[1].trim() : null;
  };

  // Name
  const rawName = field('名稱');
  if (rawName) {
    const nameMatch = rawName.match(/^(.+?)（/);
    enemy.name = nameMatch ? nameMatch[1].trim() : rawName;
  }

  // Type
  enemy.type = field('類型') || '普通';

  // Level range
  const lvl = field('等級範圍');
  if (lvl) {
    const lvlMatch = lvl.match(/Lv(\d+)-?(\d+)?/);
    if (lvlMatch) {
      enemy.levelRange = [parseInt(lvlMatch[1]), parseInt(lvlMatch[2] || lvlMatch[1])];
    }
  }

  // HP dice expression
  const hpRaw = field('HP');
  if (hpRaw) {
    const hpMatch = hpRaw.match(/(\d+d\d+[+-]?\d*)/);
    enemy.hp = hpMatch ? hpMatch[1] : hpRaw;
  }

  // AC
  const acRaw = field('AC');
  if (acRaw) {
    const acMatch = acRaw.match(/(\d+)/);
    enemy.ac = acMatch ? parseInt(acMatch[1]) : 10;
  }

  // Attack
  const atkName = field('攻擊方式');
  const atkBonus = field('攻擊加值');
  const atkDmg = field('傷害');
  if (atkName) {
    const attack = { name: atkName.replace(/（.+?）/, '').trim() };
    attack.type = /遠程|射程/.test(atkName) ? 'ranged' : 'melee';
    if (atkBonus) {
      const bonusMatch = atkBonus.match(/\+(\d+)/);
      attack.bonus = bonusMatch ? parseInt(bonusMatch[1]) : 0;
    }
    if (atkDmg) {
      const dmgMatch = atkDmg.match(/(\d+d\d+(?:[+-]\d+)?)/);
      attack.damage = dmgMatch ? dmgMatch[1] : '1d4';
      const typeMatch = atkDmg.match(/(穿刺|揮砍|鈍擊|火焰|冰霜|暗影|神聖|毒素|寒冷|奧術|黯蝕)/);
      attack.damageType = typeMatch ? typeMatch[1] : '物理';
    }
    enemy.attacks.push(attack);
  }

  // Special abilities
  const specRaw = field('特殊能力');
  if (specRaw) {
    const specParts = specRaw.split(/\*\*(.+?)\*\*[：:]/g).filter(Boolean);
    for (let i = 0; i < specParts.length - 1; i += 2) {
      enemy.special.push({ name: specParts[i].trim(), desc: specParts[i + 1].trim() });
    }
  }

  // Loot
  const lootRaw = field('掉落物品');
  if (lootRaw) {
    const lootItems = lootRaw.split(/、/);
    for (const item of lootItems) {
      const lootEntry = { name: '', price: 0, weight: 100 };
      const chanceMatch = item.match(/(\d+)%\s*機率掉落/);
      if (chanceMatch) lootEntry.weight = parseInt(chanceMatch[1]);
      const nameMatch = item.match(/(?:掉落)?([^（(]+?)(?:（|\()/);
      if (nameMatch) lootEntry.name = nameMatch[1].trim();
      const priceMatch = item.match(/(\d+)\s*(金|銀|銅)/);
      if (priceMatch) {
        const val = parseInt(priceMatch[1]);
        const unit = priceMatch[2];
        lootEntry.price = unit === '金' ? val * 100 : unit === '銀' ? val * 10 : val;
      }
      if (lootEntry.name) enemy.loot.push(lootEntry);
    }
  }

  // EXP
  const expRaw = field('EXP 獎勵');
  if (expRaw) {
    const expMatch = expRaw.match(/(\d+)/);
    enemy.exp = expMatch ? parseInt(expMatch[1]) : 0;
  }

  return enemy;
}

function parseEnemiesFile(campaign) {
  const filePath = path.join(GAME_DIR, 'campaigns', campaign, 'enemies.md');
  if (!fs.existsSync(filePath)) return new Map();

  const content = fs.readFileSync(filePath, 'utf8');
  const blocks = content.split(/(?=###\s+\d+\.\s)/);
  const enemies = new Map();

  for (const block of blocks) {
    if (!block.trim().startsWith('###')) continue;
    const enemy = parseEnemyBlock(block);
    if (enemy.name) enemies.set(enemy.name, enemy);
  }

  return enemies;
}

module.exports = { parseEnemyBlock, parseEnemiesFile };
