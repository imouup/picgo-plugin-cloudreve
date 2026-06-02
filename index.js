'use strict'

const path = require('path')
const {
  CloudreveWebDAVClient,
  buildPublicUrl,
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
    publicUrlPrefix: config.publicUrlPrefix || '',
    publicUrlTemplate: config.publicUrlTemplate || '',
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
      name: 'publicUrlPrefix',
      type: 'input',
      alias: '公开访问前缀',
      default: userConfig.publicUrlPrefix || '',
      required: false,
      message: '例如：https://img.example.com/Pictures/PicGo；留空时使用服务地址拼接远程路径'
    },
    {
      name: 'publicUrlTemplate',
      type: 'input',
      alias: '公开访问模板',
      default: userConfig.publicUrlTemplate || '',
      required: false,
      message: '可选，优先级高于公开访问前缀。支持 {path}、{rawPath}、{filename}、{rawFilename}'
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

  const nextOutput = []
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = createUploadItem(input[index], existingOutput[index], index)
    const fileName = getFileName(item, index, config.rename)
    const remoteFilePath = joinRemotePath(remoteDir, fileName)
    const buffer = getFileBuffer(item)
    const contentType = item.mimeType || item.mimetype || contentTypeFromExt(fileName)

    await client.uploadBuffer(buffer, remoteFilePath, contentType)

    nextOutput.push({
      ...item,
      fileName,
      extname: item.extname || path.extname(fileName),
      imgUrl: buildPublicUrl(config, remoteFilePath),
      type: UPLOADER_ID
    })
  }

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
