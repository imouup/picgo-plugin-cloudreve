'use strict'

const assert = require('assert')
const { test } = require('node:test')
const {
  buildDavUrl,
  buildPublicUrl,
  contentTypeFromExt,
  joinRemotePath,
  normalizeBaseUrl,
  normalizeRemoteDir
} = require('../lib/cloudreve-webdav')

test('normalizes Cloudreve server and remote paths', () => {
  assert.strictEqual(normalizeBaseUrl('https://cloud.example.com///'), 'https://cloud.example.com')
  assert.strictEqual(normalizeRemoteDir('Pictures/PicGo/'), '/Pictures/PicGo')
  assert.strictEqual(normalizeRemoteDir('/'), '')
})

test('builds WebDAV URLs with encoded path segments', () => {
  const url = buildDavUrl({
    serverUrl: 'https://cloud.example.com/base/',
    davPath: '/dav/'
  }, '/图床/hello world.png')

  assert.strictEqual(url.toString(), 'https://cloud.example.com/base/dav/%E5%9B%BE%E5%BA%8A/hello%20world.png')
})

test('joins remote file paths safely', () => {
  assert.strictEqual(joinRemotePath('/Pictures/PicGo', 'a/b.png'), '/Pictures/PicGo/a_b.png')
  assert.strictEqual(joinRemotePath('', 'cat.png'), '/cat.png')
})

test('builds public URLs from prefix or template', () => {
  assert.strictEqual(
    buildPublicUrl({ publicUrlPrefix: 'https://img.example.com/static/' }, '/Pictures/PicGo/a b.png'),
    'https://img.example.com/static/Pictures/PicGo/a%20b.png'
  )

  assert.strictEqual(
    buildPublicUrl({ publicUrlTemplate: 'https://cdn.example.com/{path}?name={rawFilename}' }, '/图床/a b.png'),
    'https://cdn.example.com/%E5%9B%BE%E5%BA%8A/a%20b.png?name=a b.png'
  )
})

test('detects common image content types', () => {
  assert.strictEqual(contentTypeFromExt('a.JPG'), 'image/jpeg')
  assert.strictEqual(contentTypeFromExt('a.webp'), 'image/webp')
  assert.strictEqual(contentTypeFromExt('a.bin'), 'application/octet-stream')
})
