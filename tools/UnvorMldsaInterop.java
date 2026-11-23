import java.nio.file.*;
import java.security.SecureRandom;
import org.bouncycastle.crypto.params.*;
import org.bouncycastle.crypto.signers.MLDSASigner;
class UnvorMldsaInterop {
 public static void main(String[] args)throws Exception{
  var root=Path.of(args[0]);var message=Files.readAllBytes(root.resolve("message"));
  var key=new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_65,Files.readAllBytes(root.resolve("secret")));
  var signer=new MLDSASigner();signer.init(true,new ParametersWithRandom(key,new SecureRandom()));signer.update(message,0,message.length);Files.write(root.resolve("native-signature"),signer.generateSignature());key.destroy();
  signer.init(false,new MLDSAPublicKeyParameters(MLDSAParameters.ml_dsa_65,Files.readAllBytes(root.resolve("public"))));signer.update(message,0,message.length);
  if(!signer.verifySignature(Files.readAllBytes(root.resolve("js-signature"))))throw new Exception("JavaScript signature rejected");
  System.out.println("Native ML-DSA-65 accepted JavaScript signature.");
 }
}
