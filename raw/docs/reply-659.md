## 回复 #659 的草稿

> 发送方式：在 https://github.com/Pal-AI-Lab/cortico-extensions/issues/659 底部评论框贴下面的正文。
> 需要我代发就给我一个 `repo` 权限的 classic PAT（`POST /issues/659/comments` 走 api.github.com，那条路通）。

---

@Phantivia 抱歉，这条从 11-02 挂到今天没回过一句。两处都动过了，逐条说。

### 一、两个密钥：已改

`src/config.ts` 里的 `amapKey` / `imageKey` 不再作为存放位置，改成宿主的 `ctx.secret()` / `ctx.storeSecret()`：

```ts
// definition.ts
keys: {
  read: (name) => ctx.secret(name),
  write: (name, value) => ctx.storeSecret(name, value),
},
persist: (patch) => ctx.persist(patch),   // 搬完把配置里那份清掉
```

变量名带前缀，因为 `.env` 是整个部署共用的一份，不带前缀会和别的 World 撞：
`JOURNEY_AMAP_KEY`、`JOURNEY_IMAGE_KEY`。

读取顺序是「`.env` 优先、配置项兜底」。老用户不用做任何事 —— 第一次启动会把
`config.json` 里那份搬进 `.env`，**确认写进去了**，再把配置清空。

那个「确认」不是多余的：宿主试挂载（dry-mount）给的 `storeSecret` 是空实现，
不抛错、只是什么都不做。要是按「没抛错就算搬好了」判断，dry-mount 跑一遍，
用户 config.json 里的 key 就没了。所以做的事是写完之后回读比对，读不回来一律保留配置。
这条有单独的测试守着（`test/secrets-migrate.test.mjs`，4 条；`test/secrets.test.mjs`，8 条）。

设置页那两栏保留，描述里写明了「填过一次会搬到 `.env`，这一栏随之变空，那是搬走了不是丢了」。

### 二、内部文件：拆成两半，一半删了

**`session-main.jsonl` / `core.log` —— 删了，功能一起去掉。**

原来读它是为了捞 `pet_say` 工具回执里那句「当前形象的词表里没有这些标记,已略过:拍拍」，
用来攒一张「她想做但这套立绘还没做出来的动作」的账。宿主丢掉不认识的词时不给任何回调，
只留这一行字，所以只有读会话文件一条路。

你说得对：为了一个动作名，把用户和她说过的所有话读一遍，代价不对。
`src/action-wishes.ts` 整个移除了，`journey_stats` 回执里那一行也不再出现。

这条功能要回来，只能靠宿主给一个回调（词被丢掉时通知一声）。在那之前，我们不做。

**`figure.json` —— 没动，但先说明为什么。**

同一段审查建议「改用公开接口，拿不到时用内置清单」。前半句目前走不通：我把宿主的
`WorldContext` 字段全列了一遍 ——

```
id / cfg / timezone / botName / botDir / packageDir / dataDir / repoRoot
secret / storeSecret / persist / restart
```

没有任何 figure 或词表接口。也就是说「当前这套立绘认识哪些动作」这件事，扩展拿不到，
只能读文件，或者退回内置清单（那样动作名会不准，她会写出立绘没有的动作）。

所以现在的做法是：读 `figure.json`，读不到就退回内置清单并在提示里说明来源。
如果后面能加一个 `ctx.figure()` 之类的接口，我们马上改过来——这个口子一旦有了，
上面那个「已略过」的回调也可以顺手一起做，两件事是同一类。

### 三、`repository` 字段

> 「包里没写 repository，只能在这里告知。」

认了。目前这个项目没有公开仓库（本地 git 没有 remote），所以暂时没法填一个真实的地址 ——
填一个 404 的链接比留空更糟。这个我还在定，定下来会补上 `repository` 与 `bugs`，
以后这类审查意见就不会再变成「找不到人只好挂个 issue」。

### 四、版本

改动已经在本地跑通，测试 1007 / 1007 通过。还没发 npm —— 下一个版本带上，
发出去之后我会在这里补一句版本号。

再次抱歉拖了 11 天。

---

### 发送前要你定的两件事

1. **要不要现在发 npm**（1.6.19）。不发也能回这条，回复里我写的是「下一个版本带上」。
2. **`repository` 怎么办**：开一个公开仓库（填真实地址），还是先留空。
   留空的话，上面「三」那段要改写成别的说法。
