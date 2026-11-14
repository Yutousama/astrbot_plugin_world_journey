### What happened / 实际发生了什么

全屏会议结束之后，桌宠整只沉到任务栏以下：只能看到头顶露在任务栏上沿，身体其余部分看不到。她还在正常活动（动作、说话都有），但人是「埋」进去的。

**不会自己恢复** —— 一沉就一直沉着，只有重启 Coopani 才回到正常位置。

### What you expected / 期望的行为

桌宠站回工作区底部，不需要重启。或者至少，任何一种「窗口尺寸变了」的情况都不该让她掉到地板下面。

### How to reproduce / 复现步骤

现场那次没抓到稳定步骤。但**机制本身可以确定性复现**（在宠物窗口的 devtools 里）：

```js
// 把 below 停在上一次的值：等价于「pet:floor 推了一个过期的数」
host.onFloor = () => {};
dispatchEvent(new Event('resize'));
```

执行后地板立刻往下掉 45 DIP，整只沉进任务栏，和现场一模一样。把 `host.onFloor` 还原、再触发一次 resize，立刻复原。

> 我这个环境（下面「本机参数」）执行后掉 45 DIP；从工作区底算，脚落到工作区以下 43 DIP。

### Coopanion version / Coopanion 版本

v0.2.19（`cortico-world-desktop-pet` 0.2.0）

### Diff against the release / 与对应 Release 的 diff

none —— 官方 release，没有改动过任何文件。

### Operating system / 操作系统

Windows 11，单显示器 2560×1440，显示缩放 100%（DPI 96）

### Figure in use / 当前形象

大肥鱼

### Model provider and model / 模型服务与模型

_No response_

### Diagnostics / 诊断包

_No response_（这是另一台机器上的现场，我这边能取到的只有本机同构参数，见下）

---

## 源码层面的定位

先把本机参数列出来，下面所有数字都基于它实测：

| 量 | 实测值 |
|---|---|
| 显示器 | 2560×1440，缩放 100% |
| 工作区 | `(0,0)-(2560,1392)`，任务栏 48 |
| 桌宠窗口 rect | `(0,0)-(2560,1437)`（枚举 HWND 得到） |

窗口底 1437 比工作区底 1392 低 45 —— 这不是错位，是设计：

```js
// host/electron-main.cjs:177 coverArea()
const strip = b.y + b.height - (y + height);              // 48（任务栏）
const below = process.platform === 'win32' ? Math.max(0, strip - OVERHANG_GAP) : 0;  // 48 - 3 = 45
return { x, y, width, height: height + below, below };    // 1392 + 45 = 1437 ✓
```

`below` 的意思是「窗口伸到工作区以下多少 DIP」。窗口故意往下多铺 45，好让形象坐在地上时腿能垂到任务栏上；代价是**页面必须自己把地板抬回去**。`coverArea()` 的注释里就写了这句话：

> the page keeps the floor at the work area's bottom

页面确实是这么算的（`web/pet-app.js:84-86`）：

```js
let below = 0;
const floorGap = () => (host ? 2 + below : 48);
const bounds = () => ({ W: innerWidth, H: innerHeight, floorY: innerHeight - floorGap(), S: .42 * prefs.scale });
```

代进本机参数：`floorY = 1437 - 2 - 45 = 1390`，比工作区底 1392 高 2 DIP —— 正确。

**`below` 归零时：`floorY = 1437 - 2 = 1435`，比正确值低 45 DIP。** 脚落在 1435，低于工作区底 1392 有 43 DIP。和现场看到的沉降量吻合。

## 关键：`below` 只有两个来源

页面里 `below` 唯一被赋值的地方是 `web/pet-app.js:133`：

```js
host?.onFloor?.((px) => { below = px; body?.set(stageSet()); });
```

主进程发 `pet:floor` 的地方有两处：

1. `cover()` —— 放置 / 铺满窗口时（`host/electron-main.cjs:390`）；
2. `did-finish-load` —— 页面重载后补发一次（`:442`）。

而页面自己的 resize 监听**只重算 bounds，不重新索取 `below`**（`web/pet-app.js:136`）：

```js
addEventListener('resize', () => {
  body?.set(stageSet());          // 用的是旧的 below
  send({ t: 'hello', screen: { w: innerWidth, h: innerHeight } });
});
```

也就是说：**`innerHeight` 变了、`below` 没跟着变，`floorY` 就会算进任务栏里。**

## 我一开始没看全的一条（先排除掉）

我原本以为「DPI 变化 / 任务栏自动隐藏」也会掉进来。查了之后不成立 —— 这几类事件都能覆盖到：

```js
// host/electron-main.cjs:567-569
screen.on('display-metrics-changed', place);
screen.on('display-added', place);
screen.on('display-removed', place);
// place = () => { if (win) cover(display()) }  →  cover() 里会重发 pet:floor
```

所以真正的缺口只剩一类：**窗口尺寸在没有经过 `cover()` 的情况下变了。**

`hideWhenFullscreen` 这条也排除了：它只是 `win.hide()` / `win.showInactive()`（`:472-473`），不改 bounds。

## 为什么沉下去之后不自愈

`kit/body.js` 的 `resize()` 最后一行（`:215`）：

```js
if (pet.mode !== 'air' && pet.mode !== 'drag') pet.fy = pet.gy;
```

这时 `pet.gy` 已经是按新 `floorY` clamp 过的值，所以这一行忠实地把脚放进坑里 —— 一秒内沉好，不抖不跳。归位逻辑本身没错，**错的是它归位到的那个 `floorY`**。

重启为什么能好：重载会走 `did-finish-load`，`pet:floor` 补发一次，`below` 回到 45。

（顺带纠一处我自己看错的地方：真正把 `pet.fy` 拉回地板的是 `land()` 里的 `pet.fy = pet.gy`（`kit/body.js:945-947`）；215 那句的作用是「窗口几何变了，让脚跟着走」，不是兜底。）

## 「对话气泡还停在正常高度」这条我判不了

`placeTalk()` 里 `pinX/pinY` 只在三种情况下写入：

- `ask` + `confirm` 的确认气泡（`web/pet-app.js:517`）
- dialog 选项卡片（`:718`）
- 被拎起来 / 还在落地过程中（`:1951`，`it.carried`）

普通 `say` 气泡不 pin，走 `place()` 会跟着人一起沉。

所以：如果当时是确认框 / 选项卡片 / 刚被拖动过，`pin` 能解释；如果是普通对话气泡，这条不成立。我手上没有当场的界面状态，**这一条请当作未证实**，只是顺手提供一个可能相关的线索。

## 本机复现不了原路径

本机窗口是 `(0,0)-(2560,1437)`，`below = 45`，`floorY = 1390`，一切正常。说明这个缺陷**只在某次 `below` 没被及时更新的瞬间才出现**，不是常年错位 —— 所以偶发、重启就好，和现场一致。

我没能找到那次「窗口变了但没走 cover()」的确切路径，这也是下面第 3 点特别想请加日志的原因。

## 想请你确认的三点

1. **`below` 的送达政策**：能不能在 `win.on('resized')` / `win.on('moved')` 里也重发一次 `pet:floor`？现在 `display-metrics-changed` 都覆盖到了，唯独窗口自身尺寸变化没有。
2. **加一条 `pet:requestFloor`**，让页面在 resize 时主动索取 `below`。现在页面在 resize 里拿不到新值，这是最直接的缺口 —— 页面明明知道 `innerHeight` 变了，却没有任何办法问「那地板现在在哪」。
3. **`pet:floor` 回调里加一行日志**（记 `below` 与 `innerHeight`）。下次再出事就能一眼对上，不用像这次一样靠推。

---

## 与 #683 的关系

#683 是 macOS 上「桌宠跑到右侧屏幕外」，那边排查结论是「位置保存/读取限制在 0–1，没有两份叠加」—— 那是 `savePosition` / 窗口 rect 那条链。

这次窗口 rect 本身完全正常（`(0,0)-(2560,1437)`，和 `coverArea()` 算出来的一致），坏的是窗口内部「地板在哪」这个数（`floorY`），**不是同一处**。所以我没把它当 #683 的重复报，但两者都指向「位置状态在某个时机没有同步」，可能有相关性。
