const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
const nativeWebCrypto = require.resolve("./src/lib/mlsNodeCryptoFallback.js");

config.resolver.resolveRequest = (context, name, platform) => {
  const source = context.originModulePath;
  const isHpkeModule = /[\\/]node_modules[\\/](?:@hpke[\\/]|mlkem[\\/])/.test(source);
  if (isHpkeModule && (name === "crypto" || name === "node:crypto")) {
    return { type: "sourceFile", filePath: nativeWebCrypto };
  }
  return context.resolveRequest(context, name, platform);
};

module.exports = config;
