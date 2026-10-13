cmake_minimum_required(VERSION 3.22.1)
project(blank_discord LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(discord_partner_sdk REQUIRED CONFIG)

add_library(blank_discord SHARED discord_presence.cpp)
target_link_libraries(blank_discord discord_partner_sdk::discord_partner_sdk)
