# @mpe/ui — MPE 统一组件库

> Minecraft Pack Editor 的统一 UI 组件库，同时服务于宿主应用和插件系统。

## 概览

`@mpe/ui` 是一个内部 workspace 包，提供统一的 UI 组件、Hooks 和工具函数。它解决了以下问题：

- **6+ 种不同的模态框实现** → 统一的 `Dialog` 组件
- **15+ 种碎片化按钮变体** → 统一的 `Button` 组件
- **碎片化图标系统** → 统一的 `Icon` 组件 + 图标注册表
- **混乱的 z-index (999~100000)** → 分层 z-index 令牌系统
- **重复的亚克力样式** → 声明式 `data-acrylic` 属性系统
- **3x 重复的 Minecraft 颜色解析** → 统一的 `useMinecraftText` hook
- **空的 hooks/ 目录** → 7 个常用 hooks

## 使用方式

### 宿主应用

```tsx
// 在 main.tsx 顶部导入设计令牌
import '@mpe/ui/tokens/variables.css';
import '@mpe/ui/tokens/z-index.css';
import '@mpe/ui/tokens/acrylic.css';
import '@mpe/ui/tokens/animations.css';

// 在组件中使用
import { Button, Dialog, Icon, useTheme } from '@mpe/ui';
```

### 插件系统

```ts
// 插件通过全局对象访问
const { Button, Dialog, Icon } = mpe.ui;
const { useTheme, useToast } = mpe.ui.hooks;
const { cn, parseMinecraftText } = mpe.ui.utils;
```

## 架构

```
sdk/mpe-ui/
├── package.json          # @mpe/ui workspace 包
├── tsconfig.json
├── src/
│   ├── index.ts          # 统一导出
│   ├── plugin-api.ts     # 插件 API 桥接层
│   ├── types.d.ts        # CSS Module 类型声明
│   ├── tokens/           # 设计令牌 (CSS Variables)
│   │   ├── variables.css # 完整变量系统
│   │   ├── z-index.css   # z-index 层级
│   │   ├── acrylic.css   # 亚克力效果
│   │   └── animations.css# 统一动画
│   ├── components/       # UI 组件
│   │   ├── Button/       # ✅ P0
│   │   ├── Icon/         # ✅ P0
│   │   ├── Dialog/       # ✅ P0
│   │   ├── ConfirmDialog/# ✅ P0
│   │   ├── Toast/        # ✅ P0/P1
│   │   ├── Input/        # 🔲 P1
│   │   ├── Select/       # 🔲 P1
│   │   ├── Tabs/         # 🔲 P1
│   │   ├── ContextMenu/  # 🔲 P1
│   │   ├── FileTree/     # 🔲 P2
│   │   ├── ResizablePanel/# 🔲 P2
│   │   ├── Slider/       # 🔲 P2
│   │   ├── ColorPicker/  # 🔲 P2
│   │   ├── ProgressBar/  # 🔲 P2
│   │   ├── Breadcrumb/   # 🔲 P3
│   │   ├── Badge/        # 🔲 P3
│   │   ├── Tooltip/      # 🔲 P3
│   │   ├── Checkbox/     # 🔲 P3
│   │   └── Toggle/       # 🔲 P3
│   ├── hooks/            # React Hooks
│   │   ├── useLocalStorage.ts    # ✅
│   │   ├── useTheme.ts          # ✅
│   │   ├── useClickOutside.ts   # ✅
│   │   ├── useKeyboardShortcut.ts# ✅
│   │   ├── useFormatSize.ts     # ✅
│   │   └── useMinecraftText.ts  # ✅
│   └── utils/            # 工具函数
│       ├── cn.ts         # className 合并
│       └── minecraft-colors.ts  # MC 颜色解析
```

## 设计令牌

### 新增变量

| 类别 | 变量 | 说明 |
|------|------|------|
| 状态色 | `--warning`, `--error`, `--info` | 补全缺失的语义色 |
| 交互 | `--bg-hover`, `--bg-active` | 统一悬停/激活背景 |
| 兼容 | `--accent-color`, `--primary-color` 等 | 别名映射到正确的令牌 |
| z-index | `--z-overlay` ~ `--z-top` | 分层系统 |
| 滚动条 | `--scrollbar-*` | 统一滚动条样式 |
| 过渡 | `--transition-fast/normal/slow` | 统一动画时长 |
| 间距 | `--space-xs` ~ `--space-3xl` | 标准化间距 |
| 字体 | `--font-sans`, `--font-mono`, `--font-size-*` | 统一排版 |

### 亚克力效果

```html
<!-- 之前: 每个组件 CSS 都要写 body.acrylic-enabled 选择器 -->
<!-- 之后: 只需添加 data-acrylic 属性 -->
<div data-acrylic>标准模糊</div>
<div data-acrylic="subtle">轻度模糊</div>
<div data-acrylic="heavy">重度模糊</div>
```

## 组件 API

### Button

```tsx
<Button variant="primary" size="md">保存</Button>
<Button variant="secondary" icon={<Icon name="settings" />}>设置</Button>
<Button variant="danger" loading>删除中...</Button>
<Button variant="icon" size="sm"><Icon name="close" /></Button>
<Button variant="ghost">取消</Button>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'primary' \| 'secondary' \| 'ghost' \| 'danger' \| 'icon'` | `'secondary'` | 视觉变体 |
| size | `'sm' \| 'md' \| 'lg'` | `'md'` | 尺寸 |
| loading | `boolean` | `false` | 加载状态 |
| icon | `ReactNode` | - | 图标 |
| fullWidth | `boolean` | `false` | 填满容器宽度 |

### Icon

```tsx
<Icon name="folder" />
<Icon name="close" size={24} color="var(--error)" />
<Icon name="settings" size={20} />
```

内置 70+ 图标，统一 stroke 风格、viewBox `0 0 24 24`。

### Dialog

```tsx
<Dialog
  open={isOpen}
  onClose={() => setOpen(false)}
  title="编辑文件"
  size="md"
  animation="scale"
  acrylic="standard"
  footer={
    <>
      <Button variant="secondary" onClick={close}>取消</Button>
      <Button variant="primary" onClick={save}>保存</Button>
    </>
  }
>
  <p>对话框内容</p>
</Dialog>
```

统一架构: `Portal → Overlay → Content`，统一 Escape 关闭、焦点管理、动画。

### ConfirmDialog

```tsx
<ConfirmDialog
  open={showConfirm}
  title="删除文件"
  message="确定要删除吗？此操作不可撤销。"
  variant="danger"
  confirmText="删除"
  onConfirm={handleDelete}
  onCancel={() => setShowConfirm(false)}
/>
```

### Toast

```tsx
// 1. 包裹 Provider
<ToastProvider><App /></ToastProvider>

// 2. 使用 hook
const { toast } = useToast();
toast({ message: '保存成功!', type: 'success' });
toast({ message: '操作失败', type: 'error', duration: 5000 });
```

## 插件权限

插件需在 `manifest.json` 中声明 UI 权限:

```json
{
  "permissions": ["ui.button", "ui.dialog", "ui.toast"]
}
```

未声明权限时，访问会被拦截并输出警告日志。
