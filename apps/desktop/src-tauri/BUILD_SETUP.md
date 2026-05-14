# Tauri Build Setup (Windows)

Rust 已安装 (1.95.0)，但缺少 Windows C++ 编译工具链。

## 安装编译工具（二选一）

### 方案 A：MinGW-w64（推荐，较小下载）

1. 下载 MinGW-w64: https://github.com/niXman/mingw-builds-binaries/releases
   - 选择 `x86_64-14.2.0-release-posix-seh-ucrt-rt_v12.2.0.7z`
2. 解压到 `C:\mingw64`
3. 添加 `C:\mingw64\bin` 到系统 PATH
4. 验证: `gcc --version` 和 `dlltool --version`

### 方案 B：Visual Studio Build Tools

1. 下载: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
2. 安装时勾选 "Desktop development with C++" 工作负载
3. 重启终端后验证: `where link.exe`

## 构建桌面应用

```bash
cd apps/desktop
pnpm tauri:dev      # 开发模式（热重载）
pnpm tauri:build    # 生产构建（生成 .msi 安装包）
```

## 当前状态

- ✅ Rust 1.95.0 (GNU) 已安装
- ✅ Tauri 2.x 项目结构已创建
- ✅ React SPA 可正常构建 (vite build)
- ✅ 系统托盘 + 自动更新已配置
- ⏳ 等待安装 MinGW-w64 后进行首次编译
