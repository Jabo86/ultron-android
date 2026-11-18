package com.ultron.messenger;

import java.security.SecureRandom;
import java.util.Arrays;
import org.bouncycastle.crypto.CryptoException;
import org.bouncycastle.crypto.params.MLDSAParameters;
import org.bouncycastle.crypto.params.MLDSAPrivateKeyParameters;
import org.bouncycastle.crypto.params.ParametersWithContext;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.crypto.signers.MLDSASigner;
import org.bouncycastle.util.encoders.Hex;

final class RelayRequestSigner {
    private static final SecureRandom RANDOM = new SecureRandom();

    static String sign(String messageHex, String contextHex, String privateKeyHex) throws CryptoException {
        byte[] key = Hex.decodeStrict(privateKeyHex);
        try {
            byte[] message = Hex.decodeStrict(messageHex);
            byte[] context = Hex.decodeStrict(contextHex);
            if (key.length != 4032 || message.length == 0 || message.length > 1024 || context.length > 255) {
                throw new IllegalArgumentException("Invalid relay signing input");
            }
            MLDSASigner signer = new MLDSASigner();
            MLDSAPrivateKeyParameters parameters = new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_65, key);
            signer.init(true, new ParametersWithContext(new ParametersWithRandom(parameters, RANDOM), context));
            signer.update(message, 0, message.length);
            return Hex.toHexString(signer.generateSignature());
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }
}
