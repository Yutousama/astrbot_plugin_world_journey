# 1.1.0 施工单

配套：`docs/BRIDGE.md`（契约 v1.1）。本单记「改哪儿、怎么改、怎么验」。

---

## 〇、已完成（本轮）

| 项 | 状态 | 位置 |
|---|---|---|
| 版本控制基线 | ✅ | 原仓库 `git init` + 首次提交 `3cbfafa`，203 个文件 |
| `.gitignore` 取消忽略 `dist/` | ✅ | `dist/webui.js` 是手写源码，不是构建产物 |
| 独立工作副本 | ✅ | `C:\Users\Administrator\WorkBuddy\coopani-world-journey-1.1.0`（`link:` 仍指向原目录，运行中的她不受影响） |
| 契约 v1.1 | ✅ | `docs/BRIDGE.md` |
| 结算引擎 | ✅ | `src/bridge.ts`（纯函数，fs 只在这一处） |
| 测试 | ✅ | `test/bridge.test.mjs`，21 条全绿 |
| 基线回归 | ✅ | 全套 845 条测试全绿（9.5 秒） |

**测试命令**（仓库里没有 `node_modules`，tsx 用宿主自带的）：

```bash
node --import "file:///E:/Coopanion/resources/app/node_modules/tsx/dist/loader.mjs" \
  --test test/bridge.test.mjs
```

> Node 22 的原生 `--experimental-strip-types` **跑不了**这个仓库：
> `amap.ts` 用了构造函数参数属性（`private key: string`），strip-only 模式直接 SyntaxError。
> 必须走 tsx。

---

## 一、待做（接进世界）

### 1. `src/state.ts`

```ts
readonly version: 1;                    // ← 不许动。改了 = 所有用户行程整份重置
rideApplied: RideApplied[];             // 新增，读不到就给 []
```

- `DEFAULT_STATE()` 加 `rideApplied: []`
- 归一化里加（**逐条校验，坏条丢掉而不是整表丢**）：

```ts
rideApplied: Array.isArray(r.rideApplied)
  ? r.rideApplied.filter((a): a is RideApplied => !!a && typeof a === 'object'
      && typeof (a as RideApplied).id === 'string'
      && typeof (a as RideApplied).dateKey === 'string'
      && ((a as RideApplied).status === 'applied' || (a as RideApplied).status === 'rejected'))
    .slice(-APPLIED_KEEP)
  : [],
```

**不要加版本分支，不要把 `version` 改成 2。** `state.ts` 里 `version !== 1` 是整份重置。

### 2. `src/config.ts`

`JourneyConfigSection` 是**扁平**的，加三个平铺开关（不要 nested `bridge: {}`，
webUi 配置项的 key 是 `worlds.journey.xxx` 平面路径）：

```ts
bridgeSpend: boolean;   // 默认 true —— 车费进账
bridgeDiary: boolean;   // 默认 true —— 日记里写车费段
bridgeLive: boolean;    // 默认 true —— 首页卡
```

默认开的理由：用户装这个桥就是为了联动。但**第一次结算要推一条 `journey.ride` 事件**
告诉他「车费记账已生效，可在设置里关」——默认开不等于默默改他的账。

### 3. `src/world.ts`（四处，全是插入）

**3.1 `tick()` —— 位置最重要**

```ts
this.ensureClock();
const now = this.worldNow();
this.settleRides();        // ← 插在这里
this.prunePledge(now);
```

**必须在三个 phase 分支 `return` 之前。** 放进 `travelTick()` 或 `stayTick()`，
在家的人永远不会结算车费——而「在家打车」恰恰是最常见的场景。

`settleRides()` 内部：

```ts
private settleRides(): void {
  if (!this.cfg.bridgeSpend && !this.cfg.bridgeDiary) return;
  const read = readPending(this.dataDir);
  if (read.problem) { this.log?.warn(read.problem); return; }
  if (read.files.length > PENDING_WARN_FILES) {
    this.log?.warn(`待结算目录里有 ${read.files.length} 个文件，对方可能一直没删。`);
  }
  if (!read.files.length) { this.unsettledRideFare = 0; return; }

  const r = settle({ ... });          // 见 bridge.ts
  this.st = { ...this.st, rideApplied: r.applied, spent: r.spent };
  this.unsettledRideFare = r.unsettled;
  if (r.settledCount) this.persist();
  for (const n of r.notices) void this.push('journey.ride', `ride-${n.id}`, n.text, 'flush');
}
```

- 注意用 `this.realNow().getTime()` 拿真实时刻，`this.worldNow().getTime()` 拿世界时刻。
  **不要写 `Date.now()`**，仓库里有「时钟只有一个入口」的测试守着。
- 有 `notices` 才推事件；一件事一条 `senderKey`，`flush` 触发。

**3.2 `persist()`**

在现有两个写点之后加第三个，**自己 try/catch，不许影响 state 落盘**：

```ts
private persist(): void {
  const err = this.store.save(this.st);
  if (err) this.log?.warn(err);
  const bad = this.travelMemory.save({...});
  ...
  this.writePublic();      // ← 新增
}
```

`writePublic()` 用 `publicSnapshot()` 生成对象，`.tmp` + rename 原子写。
**不许在 `persist()` 里 `readdir`** —— `unsettledRideFare` 用 3.1 的缓存值。

**3.3 `writeDiary()`**

```ts
const entry: DiaryEntry = {
  ...
  body: text + (this.cfg.bridgeDiary ? rideParagraph(this.st.rideApplied, key) : ''),
};
```

`rideParagraph` 每次从表重建，所以重写同一天不会重复。

**3.4 `uiSnapshot()`**

```ts
return { ..., ride: this.cfg.bridgeLive ? this.readLive() : null };
```

`readLive()` 读 `ride-live.json`，1 秒 mtime 缓存，用真实时刻判过期。
自己判过期，**不等对方写 `active:false`**。

**3.5 `JOURNEY_DESCRIBE`**

加一条事件：

```ts
{ type: 'journey.ride', description: { zh: '车费记账：正常入账 / 金额异常 / 记录被拒收。', en: '...' }, trigger: 'flush' }
```

改完跑 `pnpm describe:extension` 重生成 `describe.json`，diff 里应该只多这一条。

### 4. `src/ui.ts`

```ts
export interface UiRide { /* 与 src/bridge.ts 的 LiveRide 同形 */ }
export interface UiSnapshot { ...; readonly ride: UiRide | null }
```

### 5. `dist/webui.js`

「她此刻」面板 `mount` 里，`ride` 非空时插一张卡：车型 · 车牌、从哪到哪、进度条、`secondsToPickup`。
**不要自己跑本地倒计时** —— 用每次 poll 拿到的新值直接画，本地计时器会和面板刷新打架。

### 6. `src/plan/dayplan.ts`

`inCityMode(km, metro, rnd)` 加第四个参数 `allowTaxi = true`：

```ts
if (!allowTaxi) {
  return rnd() < 0.5
    ? { name: '公交', price: 2, min: km * 4 + 10, verb: '坐公交去' }
    : { name: '地铁', price: 4, min: km * 3 + 8, verb: '坐地铁去' };
}
```

调用点传 `allowTaxi = !(this.cfg.bridgeSpend)`。`planDay` 里还有一处「景点停车费」
跟着出租走，一并看一遍。

---

## 二、风险清单

| 风险 | 处置 |
|---|---|
| 结算写进 `travelTick`/`stayTick`，在家的人永不结算 | 放 tick 开头三个 return 之前 |
| `persist()` 有 40+ 处调用，投影里改了 `st` 会递归 | `writePublic()` 只读不写 |
| 对方从不删 pending，目录涨到几千个 | 超 500 个 `log.warn` 一次。**不自动清**——不是我们的文件 |
| `rideApplied` 让 `state.json` 从 1.9KB 涨到 ~30KB | 每 tick 多写 30KB，SSD 上无感。先这样，实测有问题再拆 |
| 面板卡跑本地倒计时与 poll 打架 | 卡上不跑计时器 |
| 对方还在写旧路径 | 契约禁止双写；探测到 1.1.0 就只写新路径 |
| 版本号 | `1.0.8` → **`1.1.0`**（新增能力，不是修 bug） |

---

## 三、给对方的最后一段

> 契约以 `docs/BRIDGE.md`（v1.1）为准。四处与你 V4 不同：
> 1. `settled.status` 是 **`applied` / `rejected`**，不是 `accepted`。
> 2. public 顶层的 **`clock.worldNow`** —— `leg` 为 null 时也在。你生成 `at` 要用它，
>    **不能用 `Date.now()`**，否则 24x 下每一条都会被判「早于行程开始」。
> 3. **坏 JSON 也会回传一条 `rejected`**，id 取文件名。所以你的文件名必须就是 `<id>.json`。
> 4. `note` 上限 **120 字**（要进 state.json），判重表 120 条。
>
> 另外：`at` 超过 20000 那条夹具的预期仍是「拒收」。你 V4 改的 3300 那条是对的。
