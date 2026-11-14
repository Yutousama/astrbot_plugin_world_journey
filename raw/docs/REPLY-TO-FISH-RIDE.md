# 车费桥已落地 · 1.1.0 联调说明

给你：契约按 `docs/BRIDGE.md`（v1.1）实现了，随 `coopani-world-journey@1.1.0` 发布。
下面只写**跟你 V4 不一样的地方**和**你怎么自测**，其余照契约。

---

## 一、五处跟你 V4 不同

| # | 你 V4 写的 | 现在的实现 | 为什么 |
|---|---|---|---|
| 1 | `settled.status: accepted \| rejected` | **`applied` \| `rejected`** | 措辞对齐「已入账」。值只有这两个，没有 `expired` —— 过期是 `rejected` 的一个 reason |
| 2 | （未提） | public 顶层新增 **`clock: { worldNow, speed }`** | 你决定 `at` 用世界时钟，但 `leg` 为 null（在家/停留）时你读不到任何时钟，就生成不了 `at` |
| 3 | 记账开关与能力位混用 | `rides.supported`（恒 true）与 **`rides.spendEnabled`**（记账开没开）分开 | 记账关着时车费不进 `spent`，你拿 `supported` 推预算就是错的 |
| 4 | （未提） | **坏 JSON 也用文件名当 id 回传 `rejected`** | 不回传的话那份文件你永远删不掉，而且每个巡检重拒一次 |
| 5 | `note` ≤ 200 字 | **≤ 120 字**，日记里原样引用 | 它要进 `state.json`（你看到 `settled` 就删文件，删完那些字只剩我这边一份），200 字 × 300 条会把 state 撑到几百 KB，而它每个巡检都写 |

另外两条口径钉死：

- **`at` 必须是世界时钟**（读 `public.clock.worldNow`），不是 `Date.now()`。24x 下用真实时间写，每一条都会被判「早于行程开始」，一条都记不上。
- **文件名必须就是 `<id>.json`**，`id` 字段必须与文件名一致。不一致判 `rejected/id`。

---

## 二、你要改的地方

1. **生成 `at` 用 `public.clock.worldNow`**，不是本机时间。
2. **`kind` 只能是 `normal | rare | special`。** `special` 只表示「超出普通叫车的一次行程」（接机、包车、专属通道）——景区内部的索道、观光车归我的 `journey_spot_ride`，不要标 `special`，否则同一段路日记里两笔。
3. **`note` 写全、写成人话、120 字以内。** 车型、司机、车牌、距离、时长全塞进去，我原样引用，不解析、不改写。空串也收，但那天日记里不提这一条。
4. **看到 `settled` 里出现自己的 id 就删文件**，`applied` 和 `rejected` 都要删。
5. **只写一种路径。** 探测到 `rides.supported` 就只写 `ride-pending/`，同一时刻只写一个 —— 旧路径在新版里没人读，写进去就是静默丢数据。
6. **格式失败时用临时文件 + rename**（你自己 V1 就写了，照做）。

---

## 三、联调步骤

前提：journey 升到 1.1.0，两个扩展装在同一个部署下（共享 `ctx.dataDir`）。

**第 1 步：确认接口在**

```bash
# dataDir 就是 <部署根>/data
cat "<dataDir>/journey-public.json"
```

能看到 `"schema": 1`、`"rides": { "supported": true, ... }` 就算通了。
**看不到这个文件 = journey 还是 1.0.x**，或者一次状态都没落过盘（启动后等一轮巡检）。

**第 2 步：投一条假单**

```bash
mkdir -p "<dataDir>/ride-pending"
cat > "<dataDir>/ride-pending/ride-test-001.json" <<'JSON'
{"schema":1,"id":"ride-test-001","at":"<从 clock.worldNow 抄一个>","cityId":"luoyang",
 "fare":54,"kind":"normal","note":"洛阳 住处 → 龙门石窟，9.7 公里，司机何师傅。"}
JSON
```

**第 3 步：等一个巡检（1x 下最多 60 秒），看三件事**

```bash
grep -A6 '"rides"' "<dataDir>/journey-public.json"       # settled 里有你的 id
grep '"spent"' "<dataDir>/journey-public.json"            # 数字 +54（记账开着时）
ls "<dataDir>/ride-pending/"                              # 文件还在——删除是你的活
```

**第 4 步：看日记**

让她写一篇当天的日记（面板或 `journey_diary_write`），正文末尾应该多一段：

```
（今天叫了 1 次车：洛阳 住处 → 龙门石窟，9.7 公里，司机何师傅。车费 54 块。）
```

同一天再写一遍，段落不会变成两段 —— 那是从 `state.rideApplied` 重建的。

**第 5 步：首页卡**

写 `ride-live.json`，`expiresAt` 给未来 5 分钟。刷新「她此刻」面板，卡会出现在「她在家/在路上」下面、「接下来」上面。
把 `expiresAt` 改到过去，刷新 —— 卡自己消失，**不需要你写 `active:false`**（你崩了它也不能永远挂着）。

---

## 四、自测清单（跑一遍就知道接得对不对）

| # | 做什么 | 看到什么算对 |
|---|---|---|
| 1 | 投一条正常单 | `spent +54`，`settled` 出现 `{id, status:"applied"}`，pending 文件仍在 |
| 2 | 同一个 id 再投一次 | `spent` 不变，`settled` 不长第二条 |
| 3 | 投 `fare: 90000` | `status:"rejected"`，`spent` 不变，她会开口说一句 |
| 4 | 投 `schema: 99` | 同上 |
| 5 | 文件名 `a.json` 但 `id: "b"` | `rejected`，reason `id` |
| 6 | 投一个坏 JSON | `rejected`，id 取文件名 |
| 7 | 投 `fare: 3300`（预算 3000） | **照记**，`spent` 加 3300，她会说一句「超过了预算的 10%」 |
| 8 | 关掉「记花销」再投 | `spendEnabled:false`、`spent` 不变、`remaining:null`，但记录照样进 `settled` |

第 8 条最容易写错：**记账关着不等于不结算** —— 日记还要用那些记录。

---

## 五、我这边明确不做的三件事

1. **不写 `cortico-world-diary`。** 跨扩展写别人的日记，失败回滚和重试的成本比这个桥本身还高。
2. **不做跨 World 调用 / HTTP 回调。** 宿主没有这个能力（`WorldContext` 只有自己的 cfg/dataDir/secret）。
3. **不拒收「超预算」的单。** 预算前置拦截是你的活；我这边只提供 `remaining`，超了照记 + 提醒。两边都以为对方拦，结果是谁都没拦。

---

## 六、关于「两套出租车」

原来我自己的排程在九公里以上会叫出租。现在：**只要 `<dataDir>/ride-pending/` 这个目录存在，我就不再自己叫车**（九公里以上改走公交/地铁）。

判据是目录在不在，不是开关开不开 —— 开关默认开着，拿它判，没装你扩展的人从此再也打不到车。

所以：**你只要跑过一次、创建过这个目录，接管就生效。** 反过来说，你卸载后如果目录还留着，我就一直不自己叫车了 —— 这个方向是安全的（少叫一次车只是少花钱，反过来是双倍收费），但你可以考虑在卸载时把空目录清掉。

---

## 七、版本

- 最低 `journey 1.1.0`，`schema: 1`
- `public` **只增不改**，改语义就 `schema + 1`
- 1.0.x 没有这个桥：靠 `journey-public.json` 存不存在降级，你已经这么写了

有任何一条对不上，直接说哪一条，不用客气。
