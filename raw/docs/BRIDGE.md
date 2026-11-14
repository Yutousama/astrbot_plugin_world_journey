# 车费桥 · 契约 v1.1

适用：`coopani-world-journey` ≥ 1.1.0 · `schema: 1`
对接方：`coopani-world-fish-ride`（下称「对方」）

> v1.1 相对 v1 的改动（其余全部不变）：
> ① 新增顶层 `clock`（`leg` 为 null 时对方也要能拿到世界时钟）
> ② `at` 明确为**世界时钟**时间
> ③ `settled.status` 取值定为 `applied | rejected`（v4 里写的 `accepted` 作废）
> ④ 新增「坏 JSON 用文件名当 id 回传」
> ⑤ `note` 上限收到 120 字、判重表收到 120 条（理由见 §4）
> ⑥ 过期判定改用**文件 mtime**，不再用 `at` 算 30 天

---

## 0. 前提

同一部署下所有 World 的 `ctx.dataDir` 是**同一个目录**（宿主 `world.ts` 的
`context()` 里 `dataDir: loaded.dataDir`）。这是桥的全部基础。

**没有跨 World 服务调用。** `WorldContext` 只有自己的 `cfg / dataDir / secret`，
`WorldHost` 只有 `pushEvent / store`；写事件只能进模型上下文，另一个 World 收不到。
所以：**只走文件，不做 RPC。**

---

## 1. 谁写哪个文件

| 路径（相对 `<dataDir>`） | 写者 | 读者 | 删除者 |
|---|---|---|---|
| `journey-public.json` | journey | 对方 | journey（覆盖写） |
| `ride-pending/<id>.json` | 对方 | journey | **对方** |
| `ride-live.json` | 对方 | journey（仅面板请求时） | 对方 |

**三条铁律：**

1. journey **永不**写、永不移动、永不删除 `ride-pending/` 和 `ride-live.json`。
2. 对方**永不**写 `journey-public.json`。
3. 对方**不许**读 `state.json` / `config.json`。那是内部格式，字段随时会变。

---

## 2. `journey-public.json`

每次 `persist()` 原子重写。**只放事实，不放算出来的现值。**

```json
{
  "schema": 1,
  "updatedAt": "2026-11-09T13:00:00.000Z",
  "clock": { "worldNow": "2026-11-09T13:00:00.000Z", "speed": 1 },
  "phase": "home | traveling | staying",
  "city": { "id": "luoyang", "name": "洛阳", "timezone": "Asia/Shanghai" },
  "leg": null,
  "money": {
    "enabled": true,
    "budget": 6000,
    "spent": 1234,
    "earned": 0,
    "pendingRideFare": 0,
    "remaining": 4766
  },
  "diary": { "enabled": true, "dir": "C:\\...\\diary" },
  "rides": {
    "supported": true,
    "spendEnabled": true,
    "settled": [{ "id": "ride-xxx", "status": "applied" }]
  }
}
```

`leg` 在路上时：

```json
{
  "fromId": "beijing", "toId": "luoyang",
  "fromName": "北京", "toName": "洛阳",
  "modeId": "train",
  "departedAt": "2026-11-08T02:00:00.000Z",
  "arriveAt": "2026-11-08T10:00:00.000Z"
}
```

### 字段语义

- **`clock.worldNow`** —— 世界时钟当前时刻。**`leg` 为 null 时也在**，因为对方生成 `at` 要用它。
- **`leg.progress` 不提供。** 进度是现值，落盘必陈旧。对方自己算：
  `(clock.worldNow - departedAt) / (arriveAt - departedAt)`，夹到 0–1。
- **`remaining`** = `budget - (spent - earned) - pendingRideFare`。
  `money.enabled === false` 或 `budget <= 0` → `null`（不限）。
- **`pendingRideFare`** —— 扫到但还没结算的总额。**正常情况下恒为 0**（扫完当场就结），
  只在结算出错的路径上有值。留着它是为了让你看到「有单挂着」，而不是看到一个偏乐观的余额。
- **`rides.supported`** 恒 `true`（1.1.0 起）。表示「这个版本有车费桥」，与对方装没装、开没开无关。
- **`rides.spendEnabled`** 表示「记账开关开着」。`false` 时 `spent` 不含车费。
  对方**不能用 `supported` 推预算**，必须看 `spendEnabled` 和 `remaining`。
- **`rides.settled`** 最近 120 条，带 `status`：`applied` | `rejected`。
  对方看到自己的 id 出现在这里（任一状态）就删掉对应文件。
  「被拒收也要删」——不删的话那份坏文件会每个 tick 被重拒一次，日志刷屏。

---

## 3. `ride-pending/<id>.json`

**七个字段，白名单。多出来的一律丢弃，不落盘。**

```json
{
  "schema": 1,
  "id": "ride-mw9btst2-90291f",
  "at": "2026-11-09T12:30:00.000Z",
  "cityId": "luoyang",
  "fare": 54,
  "kind": "normal",
  "note": "洛阳 当前位置 → 龙门石窟，舒适型 · 比亚迪秦 PLUS，9.7 公里。司机何师傅。"
}
```

| 字段 | 规则 |
|---|---|
| `schema` | 必须是 `1`。不认识 → 拒收 + 事件 |
| `id` | 全局唯一且**稳定**（重试复用同一个），1–64 字符。**文件名必须是 `<id>.json`** |
| `at` | **上车时间**，**世界时钟**（见 §5）。不是下单、不是到达 |
| `cityId` | journey 认识的城市 id |
| `fare` | 整数，`0 < fare <= 20000` |
| `kind` | `normal` \| `rare` \| `special` |
| `note` | 一句话，≤ 120 字。journey 原样引用进日记；空串则该条不进日记 |

**`note` 是细节的唯一载体。** 车型、司机、车牌、距离、时长、包车、接机、专属通道——
全部由对方在 `note` 里组织成一句人话。journey 不解析、不改写、不补全。
这样对方改玩法不用改契约。

**`kind: special` 的边界**：只表示「超出普通叫车的一次行程」（接机、包车、专属通道）。
**景区内部的索道、观光车、滑竿不算 `special`** —— 那是 journey 自己的 `journey_spot_ride`。

**坏文件也要能被处理。** 读不出 JSON 时，journey 用**文件名（去掉 `.json`）**当 id
回传一条 `rejected`。否则对方永远不知道那份文件有问题，它会一直躺在目录里。

---

## 4. 结算（journey 侧）

**触发点：** tick 开头（三个 phase 分支 `return` 之前）、`start()` 之后、`writeDiary()` 之前。
**不另开定时器。**

**算法：**

1. `readdir('ride-pending')`。`ENOENT` 视为空；其他错误记日志、跳过本 tick。
2. 逐条：
   - 已在判重表里 → **跳过**，不算拒收（等对方看到 `settled` 自己删）
   - 文件 mtime 超过 30 天 → `rejected`，`reason: 'stale'`
   - 校验失败 → `rejected`，带 `reason`
   - 通过 → `applied`
3. **校验顺序**：`schema` → `id`（含与文件名一致）→ `at` 可解析 → `at` 不早于行程开始
   → `cityId` 存在 → `fare` 整数且在区间 → `kind` 在枚举里 → `note` 截断 120 字
4. 写进判重表：`{ id, at, fare, dateKey, status, reason?, atClamped?, note? }`。
   `dateKey` 按**该条记录自己的 `cityId` 时区**换算 `at`。
5. `applied` 且 `moneyEnabled` → `spent += fare`。`rejected` 不动 `spent`。
6. **一次 `persist()`**：state 与 public 同一个出口写出去。

**判重表容量：120 条，按条数滚，不按时间滚。**
为什么不用时间：`at` 是世界时刻，倍速下「30 天」没有稳定含义。挡住老记录靠另外两道闸——
`at` 早于行程开始、文件 mtime 超 30 天。两条都过不了还能撞上滚掉，概率低到不值得加字段。

**`note` 为什么只留 120 字**：它要进 `state.json`（日记段落靠它重建），
`state.json` 每个 tick 都写。300 条 × 200 字会把 state 从 1.9KB 撑到几百 KB。

**非法 / 异常两类：**

| | 判据 | 处置 |
|---|---|---|
| 非法 | 校验失败 | 拒收，`spent` 不动，回传 `rejected`，推一条 `journey.ride` 事件 |
| 异常 | 通过校验，但 `budget > 0` 且 `fare > budget * 0.1` | **照记**，`spent` 照加，推一条事件说明金额异常 |

**只有数据错误才拒收，金额可疑只提醒。** 钱真花了不能不记。

---

## 5. 三个时钟，各归各位

| 判据 | 用哪个 | 为什么 |
|---|---|---|
| `dateKey`（归到哪天的日记） | **世界时刻** + 记录自己的城市时区 | 她按当地时间过日子 |
| `at` 是否在未来 5 分钟外（clamp） | **世界时刻** | `at` 本身就是行程时间 |
| `at` 是否早于行程开始 | **世界时刻** | `tripStartedAt` 也是世界时刻 |
| 文件是否搁置过久 | **文件 mtime + 真实时刻** | 这是「文件卫生」，不是世界里的事 |
| 判重表滚动 | 条数 | 见 §4 |

**对方生成 `at` 时必须读 `public.clock.worldNow`，不能用宿主的 `Date.now()`。**
理由：journey 的整条时间线跑在世界时钟上，24x 下世界时间一天等于真实 1 小时。
用真实时间写 `at`，每一条都会被判「早于行程开始」——一条都记不上。

混用会出真事故：拿真实时刻去卡 `at`，所有待结算单一瞬间全判死；
拿世界时刻去判「搁置 30 天」，倍速一开就全过期。

---

## 6. 日记段落

**只在 `writeDiary()` 里拼，每次从判重表确定性重建。不做累积追加。**

```
（今天叫了 2 次车：龙门石窟，9.7 公里。车费 54 块。机场接机。车费 260 块。）
```

- 取 `dateKey` 等于当天、`status === 'applied'`、`note` 非空的记录。
- 追加在正文之后，空一行，用括号与她的散文区分——这是账目，不是她的口气。
- `note` 原样引用，**车费另起一句**（不套在括号里：两对括号挨着像排版坏了）。
- 超过 3 条只引前 3 条，后面写「还有 N 次没说」。
- **同一天重写日记，段落由表重建，写几遍都只出现一次。**
- 当天有 `kind === 'special'` 的记录时，**不再写 `journey_spot_ride` 的段落**。
- 记账关闭时**不写**这个段落。

---

## 7. 首页「正在打车」卡

- journey **只在面板 `snapshot` 请求时**读 `ride-live.json`，带 1 秒 mtime 缓存。
- **不在 tick 里读。** tick 是 60 秒，进度条会跳格。
- 生效条件全满足才返回：`schema === 1` && `active === true` && `真实时刻 < expiresAt`。
- **过期自己隐藏**，不等对方写 `active: false`。它崩了卡片不能永远挂着。

---

## 8. 两套出租车的边界

`rides.spendEnabled === true` 时：

- `inCityMode()` 的 `出租` 分支**不再选**，9 公里以上改走公交/地铁。
- 城里唯一的车是对方的。
- 对方没装 / 没开 → 照旧按原规则选出租。

**景区内部代步不走这条桥**，归 `journey_spot_ride`。

---

## 9. 版本与降级

- 本契约随 **1.1.0** 落地，`schema: 1`。
- **只增不改。** 改字段语义或删字段 = `schema + 1`。
- 对方降级顺序：
  1. 没有 `journey-public.json` → 独立打车面板，不碰旅行
  2. 有 public，没有 `rides` → 只读城市/预算，不记账、不写日记
  3. 有 `rides` 但 `spendEnabled === false` → 可叫车，不记账
  4. 全部具备 → 全功能
- **只允许一种写入路径。** 探测到哪一版就写哪一版，同一时刻只写一个。不做新旧双写。

---

## 10. 验收

引擎侧（`test/bridge.test.mjs`，21 条，已绿）：

1. 正常一条 → `spent +54`，回传 `applied`，`dateKey` 正确
2. 同 id 再来 → 不重复扣，判重表不长第二条
3. `fare=90000` → `rejected/fare`，`spent` 不动
4. `schema=99` → `rejected/schema` + 事件
5. `at` 早于行程开始 → `rejected/before-trip`
6. `at` 在未来 → `atClamped`，`at` 被当前世界时刻覆盖
7. 文件名与 id 不一致 → `rejected/id`
8. 超预算 10% → 照记 + `odd` 提醒
9. 记账关着 → 照结算、进判重表、不动 `spent`
10. 额外字段（car/plate/rarity/insideAccess）不进 state
11. 日记段落重复调用完全相同；被拒记录不进正文；超 3 条只引 3 条
12. 快照 `remaining` 公式、`supported` 与 `spendEnabled` 分离
13. 首页卡：正常 / 过期 / `active:false` / 坏 schema 四种
14. 目录不存在算空；坏 JSON 用文件名回传
15. mtime 超 30 天 → `rejected/stale`
16. `fare` 边界：等于 20000 收，20001 拒

端到端（接进世界之后）：

17. 老 `state.json`（无 `rideApplied`）加载后不报错、行程不清零、`version` 仍 1
18. `ride-pending/` 不存在时 tick 不报错

---

## 11. 明确不做

- 不写 `cortico-world-diary`
- 不做跨 World 调用 / HTTP 回调
- 不读对方配置
- 不在 public 里给 `leg.progress`
- 不接受多层级结算目录（`applied/` 那套取消）
- journey **不拒绝**「超预算」的单——预算前置拦截是下单方的事
