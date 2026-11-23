import * as FileSystem from "expo-file-system/legacy";
import { bytesToBase64, randomHex } from "./crypto";
import { createCipherUploader } from "./binaryTransport";
export const uploadEncryptedBytes = createCipherUploader(FileSystem, bytesToBase64, () => randomHex(16));
