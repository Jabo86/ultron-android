package com.ultron.messenger

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class UltronNativePackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): MutableList<NativeModule> =
    mutableListOf(CallControlModule(ctx), DeviceInfoModule(ctx), KdfModule(ctx), HwKeyModule(ctx), IntegrityModule(ctx), WakeControlModule(ctx))

  override fun createViewManagers(ctx: ReactApplicationContext): MutableList<ViewManager<*, *>> =
    mutableListOf()
}
