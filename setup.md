# Setup

## 1. 安装依赖

在项目根目录运行：

```powershell
& npm.cmd install
```

如果当前机器的 Node 全局 cache 目录有权限问题，建议指定本地 cache：

```powershell
& npm.cmd install --cache .npm-cache
```

## 2. 编译

```powershell
& npm.cmd run compile
```

## 3. 运行测试

```powershell
& npm.cmd test
```

## 4. 打包 VSIX

```powershell
& npm.cmd run package:vsix
```

输出位置：

```text
releases/easy-mail-0.2.0.vsix
```

## 5. 本地 sample 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-sample-validation.ps1
```

