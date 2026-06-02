'use strict'

const path = require('path')
const {
  CloudreveWebDAVClient,
  contentTypeFromExt,
  createUploadItem,
  getFileBuffer,
  getFileName,
  joinRemotePath,
  normalizeRemoteDir
} = require('./lib/cloudreve-webdav')

const UPLOADER_ID = 'cloudreve'
const PLUGIN_NAME = 'picgo-plugin-cloudreve'

function readConfig (ctx) {
  const config = ctx.getConfig('picBed.cloudreve') || {}
  return {
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    davPath: config.davPath || '/dav',
    remotePath: config.remotePath || '',
    apiVersion: config.apiVersion || 'v4',
    apiToken: config.apiToken || '',
    sessionCookie: config.sessionCookie || '',
    fileUriPrefix: config.fileUriPrefix || 'cloudreve://my',
    timeout: Number(config.timeout) || 30000,
    rename: config.rename === true || config.rename === 'true'
  }
}

function uploaderConfig (ctx) {
  const userConfig = ctx.getConfig('picBed.cloudreve') || {}
  return [
    {
      name: 'serverUrl',
      type: 'input',
      alias: 'Cloudreve 服务地址',
      default: userConfig.serverUrl || '',
      required: true,
      message: '例如：https://cloud.example.com'
    },
    {
      name: 'username',
      type: 'input',
      alias: 'WebDAV 用户名/邮箱',
      default: userConfig.username || '',
      required: true,
      message: 'Cloudreve WebDAV 账号通常使用注册邮箱作为用户名'
    },
    {
      name: 'password',
      type: 'password',
      alias: 'WebDAV 密码',
      default: userConfig.password || '',
      required: true,
      message: '请输入 Cloudreve 生成的 WebDAV 独立密码'
    },
    {
      name: 'davPath',
      type: 'input',
      alias: 'WebDAV 路径',
      default: userConfig.davPath || '/dav',
      required: true,
      message: 'Cloudreve 默认一般为 /dav'
    },
    {
      name: 'remotePath',
      type: 'input',
      alias: '上传目录',
      default: userConfig.remotePath || 'PicGo',
      required: false,
      message: '相对 WebDAV 根目录的上传目录，例如：Pictures/PicGo'
    },
    {
      name: 'apiVersion',
      type: 'list',
      alias: 'Cloudreve API 版本',
      choices: ['v4', 'v3'],
      default: userConfig.apiVersion || 'v4',
      required: true,
      message: 'Cloudreve v4 推荐使用 API Token 获取直链；v3 使用会话 Cookie 获取直链'
    },
    {
      name: 'apiToken',
      type: 'password',
      alias: 'v4 API Token/JWT',
      default: userConfig.apiToken || '',
      required: false,
      message: 'Cloudreve v4 获取直链接口的 Bearer Token；选择 v4 时必填'
    },
    {
      name: 'sessionCookie',
      type: 'password',
      alias: 'v3 会话 Cookie',
      default: userConfig.sessionCookie || '',
      required: false,
      message: 'Cloudreve v3 已登录会话 Cookie，例如 cloudreve-session=...；选择 v3 时必填'
    },
    {
      name: 'fileUriPrefix',
      type: 'input',
      alias: '文件 URI 前缀',
      default: userConfig.fileUriPrefix || 'cloudreve://my',
      required: false,
      message: 'v4 获取直链使用，例如 cloudreve://my 或 cloudreve://my/已绑定根目录'
    },
    {
      name: 'timeout',
      type: 'input',
      alias: '请求超时(ms)',
      default: userConfig.timeout || 30000,
      required: false,
      message: '默认 30000'
    },
    {
      name: 'rename',
      type: 'confirm',
      alias: '自动重命名',
      default: userConfig.rename === true,
      required: false,
      message: '是否为上传文件追加时间戳，避免同名覆盖'
    }
  ]
}

function notifyError (ctx, error) {
  ctx.emit('notification', {
    title: 'Cloudreve 上传失败',
    body: error && error.message ? error.message : String(error),
    text: ''
  })
}

async function handle (ctx) {
  const config = readConfig(ctx)
  const client = new CloudreveWebDAVClient(config)
  const remoteDir = normalizeRemoteDir(config.remotePath)
  const input = Array.isArray(ctx.input) ? ctx.input : []
  const existingOutput = Array.isArray(ctx.output) ? ctx.output : []
  const sourceItems = existingOutput.length > 0 ? existingOutput : input

  if (sourceItems.length === 0) {
    throw new Error('PicGo 未提供待上传图片')
  }

  await client.ensureDirectory(remoteDir)

  const uploadedItems = []
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = createUploadItem(input[index], existingOutput[index], index)
    const fileName = getFileName(item, index, config.rename)
    const remoteFilePath = joinRemotePath(remoteDir, fileName)
    const buffer = getFileBuffer(item)
    const contentType = item.mimeType || item.mimetype || contentTypeFromExt(fileName)

    await client.uploadBuffer(buffer, remoteFilePath, contentType)
    uploadedItems.push({ item, fileName, remoteFilePath })
  }

  const directLinks = await client.getDirectLinks(uploadedItems.map(uploaded => uploaded.remoteFilePath))
  const nextOutput = uploadedItems.map((uploaded, index) => ({
    ...uploaded.item,
    fileName: uploaded.fileName,
    extname: uploaded.item.extname || path.extname(uploaded.fileName),
    imgUrl: directLinks[index],
    type: UPLOADER_ID
  }))

  ctx.output = nextOutput
  return ctx
}

module.exports = ctx => {
  const register = () => {
    ctx.helper.uploader.register(UPLOADER_ID, {
      name: 'Cloudreve',
      handle: async innerCtx => {
        try {
          return await handle(innerCtx)
        } catch (error) {
          notifyError(innerCtx, error)
          throw error
        }
      },
      config: uploaderConfig
    })
  }

  return {
    register,
    uploader: UPLOADER_ID,
    config: () => [],
    pluginName: PLUGIN_NAME
  }
}

module.exports.handle = handle
module.exports.uploaderConfig = uploaderConfig
module.exports.readConfig = readConfig
