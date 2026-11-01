const {
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VARIANTS = [
  { id: 'default', alias: 'LauncherDefault', iosName: null, asset: 'icon-padded.png', enabled: true },
  { id: 'streak_fire', alias: 'LauncherStreakFire', iosName: 'StreakFire', asset: 'icon-streak-fire.png', enabled: false },
  { id: 'unread_urgent', alias: 'LauncherUnreadUrgent', iosName: 'UnreadUrgent', asset: 'icon-unread-urgent.png', enabled: false },
  { id: 'sad_inactive', alias: 'LauncherSadInactive', iosName: 'SadInactive', asset: 'icon-sad-inactive.png', enabled: false },
  { id: 'ghost_abandoned', alias: 'LauncherGhostAbandoned', iosName: 'GhostAbandoned', asset: 'icon-ghost-abandoned.png', enabled: false },
  { id: 'champion_crown', alias: 'LauncherChampionCrown', iosName: 'ChampionCrown', asset: 'icon-champion-crown.png', enabled: false },
  { id: 'on_fire_shipped', alias: 'LauncherOnFireShipped', iosName: 'OnFireShipped', asset: 'icon-shipped.png', enabled: false },
  { id: 'milestone_party', alias: 'LauncherMilestoneParty', iosName: 'MilestoneParty', asset: 'icon-milestone-party.png', enabled: false },
  { id: 'night_owl', alias: 'LauncherNightOwl', iosName: 'NightOwl', asset: 'icon-night-owl.png', enabled: false },
  { id: 'weekend_chill', alias: 'LauncherWeekendChill', iosName: 'WeekendChill', asset: 'icon-weekend-chill.png', enabled: false },
];

const resName = (id) => `ic_launcher_variant_${id}`;

function withAndroidDynamicIcons(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;
    const pkg = mod.android?.package || 'com.tana.linkup';

    // Remove LAUNCHER category from MainActivity so only the active activity-alias shows in launcher
    const activities = app.activity || [];
    for (const act of activities) {
      const name = act.$?.['android:name'] || '';
      if (name === '.MainActivity' || name.endsWith('.MainActivity')) {
        for (const filter of act['intent-filter'] || []) {
          if (Array.isArray(filter.category)) {
            filter.category = filter.category.filter(
              (c) => c.$?.['android:name'] !== 'android.intent.category.LAUNCHER',
            );
          }
        }
      }
    }

    const existing = (app['activity-alias'] || []).filter(
      (a) => !VARIANTS.some((v) => a.$?.['android:name'] === `${pkg}.${v.alias}` || a.$?.['android:name'] === `.${v.alias}`),
    );

    const aliases = VARIANTS.map((v) => ({
      $: {
        'android:name': `${pkg}.${v.alias}`,
        'android:enabled': v.enabled ? 'true' : 'false',
        'android:exported': 'true',
        'android:icon': `@mipmap/${resName(v.id)}`,
        'android:roundIcon': `@mipmap/${resName(v.id)}`,
        'android:label': '@string/app_name',
        'android:targetActivity': '.MainActivity',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        },
      ],
    }));

    app['activity-alias'] = [...existing, ...aliases];
    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const platformRoot = mod.modRequest.platformProjectRoot;
      const pkg = (mod.android?.package || 'com.tana.linkup').replace(/\./g, '/');

      // 1. Copy bundled PNGs into mipmap-xxhdpi & raw keep rules so R8 shrinkResources preserves all 10 icons
      const mipmapDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'mipmap-xxhdpi');
      const rawDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(mipmapDir, { recursive: true });
      fs.mkdirSync(rawDir, { recursive: true });

      for (const v of VARIANTS) {
        const src = path.join(projectRoot, 'assets', v.asset);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(mipmapDir, `${resName(v.id)}.png`));
        }
      }

      const keepTargets = VARIANTS.map((v) => `@mipmap/${resName(v.id)}`).join(',');
      fs.writeFileSync(
        path.join(rawDir, 'keep_dynamic_icons.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${keepTargets}" />\n`,
      );

      // 2. Write Kotlin native module + lifecycle switcher (stages swap until background so foreground UI is never killed)
      const javaDir = path.join(platformRoot, 'app', 'src', 'main', 'java', pkg, 'dynamicicon');
      fs.mkdirSync(javaDir, { recursive: true });
      const pkgDot = mod.android?.package || 'com.tana.linkup';
      const aliasMapEntries = VARIANTS.map((v) => `"${v.id}" to "${pkgDot}.${v.alias}"`).join(',\n      ');

      fs.writeFileSync(
        path.join(javaDir, 'LinkupDynamicIconModule.kt'),
        `package ${pkgDot}.dynamicicon

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LinkupDynamicIconModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), Application.ActivityLifecycleCallbacks {

  companion object {
    private const val PREFS = "linkup_dynamic_icon"
    private const val KEY_DESIRED = "desired_variant"
    private const val KEY_APPLIED = "applied_variant"
    val ALIASES = mapOf(
      ${aliasMapEntries}
    )
  }

  private var startedActivities = 0

  init {
    (reactContext.applicationContext as? Application)?.registerActivityLifecycleCallbacks(this)
  }

  override fun getName(): String = "LinkupDynamicIcon"

  @ReactMethod
  fun getCurrentIcon(promise: Promise) {
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    promise.resolve(prefs.getString(KEY_DESIRED, prefs.getString(KEY_APPLIED, "default")) ?: "default")
  }

  @ReactMethod
  fun setAlternateIcon(variantId: String?, promise: Promise) {
    val target = if (variantId != null && ALIASES.containsKey(variantId)) variantId else "default"
    val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_DESIRED, target).apply()
    if (startedActivities <= 0) {
      applyPendingSwap(reactContext.applicationContext)
    }
    promise.resolve(target)
  }

  private fun applyPendingSwap(ctx: Context) {
    try {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val desired = prefs.getString(KEY_DESIRED, "default") ?: "default"
      val applied = prefs.getString(KEY_APPLIED, "default") ?: "default"
      if (desired == applied) return
      val desiredClass = ALIASES[desired] ?: ALIASES["default"] ?: return
      val pm = ctx.packageManager
      pm.setComponentEnabledSetting(
        ComponentName(ctx.packageName, desiredClass),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP
      )
      for ((key, cls) in ALIASES) {
        if (key != desired) {
          val defaultDisabledState = if (key == "default")
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
          else
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
          pm.setComponentEnabledSetting(
            ComponentName(ctx.packageName, cls),
            defaultDisabledState,
            PackageManager.DONT_KILL_APP
          )
        }
      }
      prefs.edit().putString(KEY_APPLIED, desired).apply()
    } catch (_: Throwable) {}
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
  override fun onActivityStarted(activity: Activity) { startedActivities++ }
  override fun onActivityResumed(activity: Activity) {}
  override fun onActivityPaused(activity: Activity) {}
  override fun onActivityStopped(activity: Activity) {
    startedActivities = (startedActivities - 1).coerceAtLeast(0)
    if (startedActivities == 0) {
      applyPendingSwap(activity.applicationContext)
    }
  }
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  override fun onActivityDestroyed(activity: Activity) {}
}
`,
      );

      fs.writeFileSync(
        path.join(javaDir, 'LinkupDynamicIconPackage.kt'),
        `package ${pkgDot}.dynamicicon

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LinkupDynamicIconPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(LinkupDynamicIconModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`,
      );

      return mod;
    },
  ]);

  config = withMainApplication(config, (mod) => {
    const pkgDot = mod.android?.package || 'com.tana.linkup';
    const importLine = `import ${pkgDot}.dynamicicon.LinkupDynamicIconPackage`;
    let src = mod.modResults.contents;
    if (!src.includes(importLine)) {
      src = src.replace(/(package\s+[^\n]+\n)/, `$1${importLine}\n`);
    }
    if (!src.includes('LinkupDynamicIconPackage()')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(LinkupDynamicIconPackage())',
      );
    }
    mod.modResults.contents = src;
    return mod;
  });

  return config;
}

function withIosDynamicIcons(config) {
  config = withInfoPlist(config, (mod) => {
    const alternates = {};
    for (const v of VARIANTS) {
      if (!v.iosName) continue;
      alternates[v.iosName] = {
        CFBundleIconFiles: [v.iosName],
        UIPrerenderedIcon: false,
      };
    }
    mod.modResults.CFBundleIcons = {
      ...(mod.modResults.CFBundleIcons || {}),
      CFBundleAlternateIcons: alternates,
    };
    mod.modResults['CFBundleIcons~ipad'] = {
      ...(mod.modResults['CFBundleIcons~ipad'] || {}),
      CFBundleAlternateIcons: alternates,
    };
    return mod;
  });

  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const appName = mod.modRequest.projectName || 'LINKUP';
      const iosAppDir = path.join(mod.modRequest.platformProjectRoot, appName);
      if (fs.existsSync(iosAppDir)) {
        for (const v of VARIANTS) {
          if (!v.iosName) continue;
          const src = path.join(projectRoot, 'assets', v.asset);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(iosAppDir, `${v.iosName}@2x.png`));
            fs.copyFileSync(src, path.join(iosAppDir, `${v.iosName}@3x.png`));
          }
        }
      }
      return mod;
    },
  ]);

  return config;
}

module.exports = function withDynamicLauncherIcon(config) {
  config = withAndroidDynamicIcons(config);
  config = withIosDynamicIcons(config);
  return config;
};
module.exports.VARIANTS = VARIANTS;
