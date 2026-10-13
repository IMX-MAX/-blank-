// Rich Presence through the Discord Social SDK, without signing in: it talks to the Discord app on the phone.
// Every SDK call runs on one worker thread, which also pumps the SDK's callbacks.
#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"

#include <jni.h>

#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace {

std::mutex gLock;
std::condition_variable gWake;
std::deque<std::function<void()>> gJobs;
std::thread gWorker;
bool gStarted = false;
std::shared_ptr<discordpp::Client> gClient;

void post(std::function<void()> job) {
  {
    std::lock_guard<std::mutex> guard(gLock);
    gJobs.push_back(std::move(job));
  }
  gWake.notify_one();
}

void loop() {
  for (;;) {
    std::deque<std::function<void()>> batch;
    {
      std::unique_lock<std::mutex> guard(gLock);
      gWake.wait_for(guard, std::chrono::milliseconds(100), [] { return !gJobs.empty(); });
      batch.swap(gJobs);
    }
    for (auto& job : batch) job();
    discordpp::RunCallbacks();
  }
}

std::string toString(JNIEnv* env, jbyteArray bytes) {
  if (bytes == nullptr) return std::string();
  jsize length = env->GetArrayLength(bytes);
  std::string text(static_cast<size_t>(length), '\0');
  if (length > 0) env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte*>(&text[0]));
  return text;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL Java_app_blank_player_DiscordPresence_nativeStart(JNIEnv*, jclass, jlong applicationId) {
  std::lock_guard<std::mutex> guard(gLock);
  if (gStarted) return;
  gStarted = true;
  gJobs.push_back([applicationId] {
    gClient = std::make_shared<discordpp::Client>();
    gClient->SetApplicationId(static_cast<uint64_t>(applicationId));
  });
  gWorker = std::thread(loop);
  gWorker.detach();
}

extern "C" JNIEXPORT void JNICALL Java_app_blank_player_DiscordPresence_nativeUpdate(
    JNIEnv* env, jclass, jbyteArray details, jbyteArray state, jbyteArray album, jlong startSeconds, jlong endSeconds) {
  std::string detailsText = toString(env, details);
  std::string stateText = toString(env, state);
  std::string albumText = toString(env, album);
  post([=] {
    if (!gClient) return;
    discordpp::Activity activity;
    activity.SetType(discordpp::ActivityTypes::Listening);
    if (!detailsText.empty()) activity.SetDetails(detailsText);
    if (!stateText.empty()) activity.SetState(stateText);

    discordpp::ActivityTimestamps timestamps;
    timestamps.SetStart(static_cast<uint64_t>(startSeconds));
    if (endSeconds > 0) timestamps.SetEnd(static_cast<uint64_t>(endSeconds));
    activity.SetTimestamps(timestamps);

    // "blank" is an art asset on the application's Rich Presence page; without it Discord shows no image.
    discordpp::ActivityAssets assets;
    assets.SetLargeImage("blank");
    if (!albumText.empty()) assets.SetLargeText(albumText);
    activity.SetAssets(assets);

    gClient->UpdateRichPresence(activity, [](discordpp::ClientResult) {});
  });
}

extern "C" JNIEXPORT void JNICALL Java_app_blank_player_DiscordPresence_nativeClear(JNIEnv*, jclass) {
  post([] {
    if (gClient) gClient->ClearRichPresence();
  });
}
