Pod::Spec.new do |s|
  s.name           = 'DarouNative'
  s.version        = '1.0.0'
  s.summary        = 'App Group snapshot, queued intents, Live Activities and motion sensors for the 다루 app'
  s.description    = s.summary
  s.author         = 'diet-routine'
  s.homepage       = 'https://diet-routine.vercel.app'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'WidgetKit', 'CoreMotion'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
