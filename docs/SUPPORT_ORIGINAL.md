# 敵方支援原始模式封存

這是本專案目前可追溯的最早 Git 快照 **9d6b8d9**，不是推測更早上游版本。原註解提到「以前 15%」只是歷史註解，該快照實際使用 7% 起算。此文件不會切換目前遊戲模式，也沒有新增 runtime 開關。

## 原始規則

- 治療比例 = 0.07 × min(2.5, P^0.35)，P 為所有玩家 atk/baseAtk 的最大值，至少 1；每次約最大生命 7%～17.5%。
- 每個治療者原始施法冷卻 5 秒；有敵對玩家進入其施法判定範圍才施法。首次冷卻依敵人物件初始化隨機。
- 查詢 queryCircle(x,y,150)，實際邊界包含目標碰撞半徑：距離 ≤ 150 + target.r。可穿牆、不限受療人數。
- 只排除死亡與滿血，允許自療、治療者互補、頭目／傳說／制裁個體。
- 不設同目標共同治療間隔、不設累積回血或補盾預算。
- 生成器沒有前 60／120 秒強制排除，也沒有治療者專用場上上限；仍受一般敵人池、總數與其他事件規則限制。
- 原始護盾每次替最近最多 6 名存活敵人補至最大生命 35%，持續 8 秒，可再次補回與刷新；範圍查詢 160，沒有隔牆或特殊敵人排除。

## 原始實作摘錄（含原註解）

```js
    healAround() {
      // 7 % de la vida (era 15 %: con varios curanderos curaban más de lo que
      // pegabas), y más cuanto más fuerte pegas, pero cada vez menos: con el
      // doble de ataque cura un 27 % más, con 10 veces más un 124 %, y como
      // mucho ×2,5. (Como los enemigos que tienen más vida si haces más daño.)
      const pow = Math.max(1, ...G.Game.everyone().map(p => (p.atk > 0 && p.baseAtk > 0 ? p.atk / p.baseAtk : 1)));
      const k = 0.07 * Math.min(2.5, Math.pow(pow, 0.35));
      let n = 0;
      for (const e of G.EnemyMgr.queryCircle(this.x, this.y, 150)) {
        if (e.dead || e.hp >= e.maxHp) continue;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * k);
        G.FX.burst(e.x, e.y - e.bodyH * 0.6, '#7dffb0', 5, 60);
        n++;
      }
      this.anim.play('Charge');
      G.FX.ring(this.x, this.y, 8, 150, '#5fe08a', 0.5, 3);
      if (G.Coop.isHost) G.Coop.broadcast(['fxr', Math.round(this.x), Math.round(this.y), 150, '#5fe08a']);
      if (n && G.Camera.sees(this.x, this.y, 0)) G.Audio.sfx('heal');
    }

    castShields() {
      const near = G.EnemyMgr.queryCircle(this.x, this.y, 160).filter(e => !e.dead)
        .sort((a, b) => G.U.dist2(a.x, a.y, this.x, this.y) - G.U.dist2(b.x, b.y, this.x, this.y)).slice(0, 6);
      for (const e of near) { e.shield = Math.max(e.shield, e.maxHp * 0.35); e.shieldT = 8; }
      this.anim.play('Charge');
      G.FX.ring(this.x, this.y, 8, 160, '#7fc8ff', 0.5, 3);
      if (G.Coop.isHost) G.Coop.broadcast(['fxr', Math.round(this.x), Math.round(this.y), 160, '#7fc8ff']);
    }

```

## 日後調用方式

可以要求「按照 SUPPORT_ORIGINAL.md 的原始模式恢復治療／護盾」，並指定是否一併恢復生成規則。Git 可讀取精確來源：

```sh
git show 9d6b8d9:js/entities/enemy.js
git show 9d6b8d9:js/systems/spawner.js
git show 9d6b8d9:js/data/enemies.js
```

恢復時只遷回對應支援方法與生成規則，重新驗證合作權威與相關測試，不直接覆蓋整份 Enemy 檔案，以免移除後來的其他修正。a8bc71b 是第一版限額平衡；當前規則見 [SUPPORT_BALANCE.md](SUPPORT_BALANCE.md)。所有已提交版本都保留，無 ZIP 備份。
