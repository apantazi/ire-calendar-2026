# ============================================================
# IRE 2026 Sessionize schedule browser
# Pulls JSON, flattens sessions/speakers/categories/rooms,
# analyzes the schedule, and writes a browsable HTML page.
#
# No custom functions are defined in this script.
# ============================================================

# ---- Packages ----
# Run once if needed:
# install.packages(c(
#   "jsonlite", "dplyr", "tidyr", "stringr", "lubridate",
#   "DT", "htmltools", "htmlwidgets"
# ))

library(jsonlite)
library(dplyr)
library(tidyr)
library(stringr)
library(lubridate)
library(DT)
library(htmltools)
library(htmlwidgets)

# ---- Settings ----
schedule_url <- "https://2026-ire-conference.sessionize.com/api/schedule"
local_tz <- "America/New_York"
out_html <- "ire26_session_browser.html"

# ---- Pull JSON ----
# jsonlite::fromJSON() reads the URL directly and converts top-level
# arrays into data frames where possible.
schedule_json <- jsonlite::fromJSON(
  txt = schedule_url,
  flatten = TRUE
)

# ---- Base tables from JSON ----
sessions_raw <- schedule_json$sessions
speakers_raw <- schedule_json$speakers
questions_raw <- schedule_json$questions
categories_raw <- schedule_json$categories
rooms_raw <- schedule_json$rooms

# ---- Room lookup ----
rooms <- rooms_raw %>%
  transmute(
    room_id = id,
    room = name,
    room_sort = sort
  )

# ---- Speaker lookup ----
speakers <- speakers_raw %>%
  transmute(
    speaker_id = id,
    speaker_first = firstName,
    speaker_last = lastName,
    speaker_name = fullName,
    speaker_org_title = tagLine,
    speaker_bio = bio,
    speaker_profile_picture = profilePicture,
    speaker_is_top = isTopSpeaker
  )

# ---- Category lookup ----
# categories_raw$items is a nested list/data-frame column.
# unnest() turns each category item into one row.
category_lookup <- categories_raw %>%
  select(
    category_group_id = id,
    category_group = title,
    category_group_sort = sort,
    category_group_type = type,
    items
  ) %>%
  tidyr::unnest(items, names_sep = "_") %>%
  transmute(
    category_group_id,
    category_group,
    category_group_sort,
    category_group_type,
    category_item_id = items_id,
    category_item_name = items_name,
    category_item_sort = items_sort
  )

# ---- Clean core session table ----
# ---- Clean core session table ----
# Use transmute() so we keep only scalar columns we actually want.
# This drops raw nested JSON columns like speakers, categoryItems,
# and questionAnswers before later joins.
sessions <- sessions_raw %>%
  transmute(
    session_id = id,
    title = title,
    description = description,
    startsAt = startsAt,
    endsAt = endsAt,
    roomId = roomId,
    isServiceSession = isServiceSession,
    isPlenumSession = isPlenumSession,
    status = status,
    liveUrl = liveUrl,
    recordingUrl = recordingUrl,
    isInformed = isInformed,
    isConfirmed = isConfirmed,
    
    starts_at = lubridate::ymd_hms(startsAt, tz = local_tz),
    ends_at = lubridate::ymd_hms(endsAt, tz = local_tz),
    session_date = as.Date(starts_at),
    session_day = lubridate::wday(starts_at, label = TRUE, abbr = FALSE),
    start_time = format(starts_at, "%I:%M %p"),
    end_time = format(ends_at, "%I:%M %p"),
    time_block = paste(start_time, "-", end_time),
    duration_minutes = as.numeric(difftime(ends_at, starts_at, units = "mins")),
    
    description_clean = stringr::str_squish(
      stringr::str_replace_all(
        dplyr::coalesce(description, ""),
        "\\r\\n|\\n|\\r",
        " "
      )
    ),
    
    session_kind = dplyr::if_else(
      isServiceSession,
      "Service / break",
      "Content"
    ),
    
    plenum_kind = dplyr::if_else(
      isPlenumSession,
      "Plenary",
      "Concurrent"
    )
  ) %>%
  left_join(rooms, by = c("roomId" = "room_id")) %>%
  arrange(starts_at, room_sort, title)

# ---- Session-to-speaker bridge ----
session_speakers_long <- sessions_raw %>%
  select(session_id = id, speakers) %>%
  tidyr::unnest_longer(
    col = speakers,
    values_to = "speaker_id",
    keep_empty = TRUE
  ) %>%
  filter(!is.na(speaker_id)) %>%
  left_join(speakers, by = "speaker_id")

session_speakers <- session_speakers_long %>%
  group_by(session_id) %>%
  summarize(
    speaker_count = n_distinct(speaker_id),
    speakers = paste(sort(unique(speaker_name)), collapse = "; "),
    speaker_org_titles = paste(sort(unique(na.omit(speaker_org_title))), collapse = " | "),
    .groups = "drop"
  )

# ---- Session-to-category bridge ----
session_categories_long <- sessions_raw %>%
  select(session_id = id, categoryItems) %>%
  tidyr::unnest_longer(
    col = categoryItems,
    values_to = "category_item_id",
    keep_empty = TRUE
  ) %>%
  filter(!is.na(category_item_id)) %>%
  mutate(category_item_id = as.integer(category_item_id)) %>%
  left_join(category_lookup, by = "category_item_id")

session_types <- session_categories_long %>%
  filter(category_group == "Session type") %>%
  group_by(session_id) %>%
  summarize(
    session_type = paste(sort(unique(category_item_name)), collapse = "; "),
    .groups = "drop"
  )

session_tracks <- session_categories_long %>%
  filter(category_group == "Tracks") %>%
  group_by(session_id) %>%
  summarize(
    tracks = paste(sort(unique(category_item_name)), collapse = "; "),
    .groups = "drop"
  )

session_recording <- session_categories_long %>%
  filter(category_group == "Recorded?") %>%
  group_by(session_id) %>%
  summarize(
    recording_status = paste(sort(unique(category_item_name)), collapse = "; "),
    .groups = "drop"
  )

# ---- Final session browser table ----
session_browser <- sessions %>%
  left_join(session_speakers, by = "session_id") %>%
  left_join(session_types, by = "session_id") %>%
  left_join(session_tracks, by = "session_id") %>%
  left_join(session_recording, by = "session_id") %>%
  mutate(
    speaker_count = dplyr::coalesce(speaker_count, 0L),
    speakers = dplyr::coalesce(speakers, ""),
    speaker_org_titles = dplyr::coalesce(speaker_org_titles, ""),
    session_type = dplyr::coalesce(session_type, ""),
    tracks = dplyr::coalesce(tracks, ""),
    recording_status = dplyr::coalesce(recording_status, ""),
    description_clean = dplyr::coalesce(description_clean, "")
  ) %>%
  select(
    session_date,
    session_day,
    time_block,
    duration_minutes,
    room,
    session_kind,
    plenum_kind,
    session_type,
    tracks,
    recording_status,
    title,
    speakers,
    speaker_org_titles,
    description_clean,
    status,
    liveUrl,
    recordingUrl,
    session_id
  ) %>%
  arrange(session_date, time_block, room, title)

# ---- Analysis tables ----
summary_by_day <- session_browser %>%
  group_by(session_date, session_day) %>%
  summarize(
    total_rows = n(),
    content_sessions = sum(session_kind == "Content"),
    service_or_break_rows = sum(session_kind == "Service / break"),
    total_session_minutes = sum(duration_minutes, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  arrange(session_date)

summary_by_room <- session_browser %>%
  group_by(room) %>%
  summarize(
    total_rows = n(),
    content_sessions = sum(session_kind == "Content"),
    service_or_break_rows = sum(session_kind == "Service / break"),
    .groups = "drop"
  ) %>%
  arrange(desc(content_sessions), room)

summary_by_session_type <- session_browser %>%
  filter(session_kind == "Content") %>%
  count(session_type, sort = TRUE, name = "content_sessions")

summary_by_track <- session_categories_long %>%
  filter(category_group == "Tracks") %>%
  count(category_item_name, sort = TRUE, name = "sessions") %>%
  rename(track = category_item_name)

summary_by_recording_status <- session_browser %>%
  filter(session_kind == "Content") %>%
  count(recording_status, sort = TRUE, name = "content_sessions")

speaker_session_counts <- session_speakers_long %>%
  filter(!is.na(speaker_id)) %>%
  count(
    speaker_name,
    speaker_org_title,
    sort = TRUE,
    name = "session_count"
  )

room_day_matrix <- session_browser %>%
  filter(session_kind == "Content") %>%
  count(session_date, session_day, room, name = "content_sessions") %>%
  arrange(session_date, room)

# ---- Optional CSV exports ----
write.csv(session_browser, "ire26_sessions_flat.csv", row.names = FALSE)
write.csv(summary_by_day, "ire26_summary_by_day.csv", row.names = FALSE)
write.csv(summary_by_track, "ire26_summary_by_track.csv", row.names = FALSE)
write.csv(speaker_session_counts, "ire26_speaker_session_counts.csv", row.names = FALSE)

# ---- Build interactive tables ----
session_table <- DT::datatable(
  session_browser,
  rownames = FALSE,
  filter = "top",
  extensions = c("Buttons", "Responsive"),
  options = list(
    pageLength = 25,
    scrollX = TRUE,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel"),
    searchHighlight = TRUE,
    autoWidth = TRUE
  )
)

day_table <- DT::datatable(
  summary_by_day,
  rownames = FALSE,
  extensions = c("Buttons"),
  options = list(
    pageLength = 10,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel")
  )
)

track_table <- DT::datatable(
  summary_by_track,
  rownames = FALSE,
  filter = "top",
  extensions = c("Buttons"),
  options = list(
    pageLength = 20,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel")
  )
)

room_table <- DT::datatable(
  summary_by_room,
  rownames = FALSE,
  filter = "top",
  extensions = c("Buttons"),
  options = list(
    pageLength = 25,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel")
  )
)

recording_table <- DT::datatable(
  summary_by_recording_status,
  rownames = FALSE,
  options = list(
    pageLength = 10,
    dom = "tip"
  )
)

speaker_table <- DT::datatable(
  speaker_session_counts,
  rownames = FALSE,
  filter = "top",
  extensions = c("Buttons"),
  options = list(
    pageLength = 25,
    scrollX = TRUE,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel")
  )
)

room_day_table <- DT::datatable(
  room_day_matrix,
  rownames = FALSE,
  filter = "top",
  extensions = c("Buttons"),
  options = list(
    pageLength = 25,
    dom = "Bfrtip",
    buttons = c("copy", "csv", "excel")
  )
)

# ---- Headline metrics ----
total_rows <- nrow(session_browser)
content_sessions <- sum(session_browser$session_kind == "Content")
service_rows <- sum(session_browser$session_kind == "Service / break")
total_speakers <- n_distinct(speakers$speaker_id)
total_rooms <- n_distinct(rooms$room_id)
total_tracks <- nrow(summary_by_track)

# ---- HTML page ----
page <- htmltools::tagList(
  htmltools::tags$head(
    htmltools::tags$meta(charset = "utf-8"),
    htmltools::tags$title("IRE 2026 session browser"),
    htmltools::tags$style(htmltools::HTML("
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin: 32px;
        line-height: 1.45;
        color: #222;
      }
      h1, h2 {
        margin-top: 1.2em;
      }
      .muted {
        color: #666;
      }
      .cards {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 20px 0 28px 0;
      }
      .card {
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 14px 18px;
        min-width: 150px;
        background: #fafafa;
      }
      .metric {
        font-size: 30px;
        font-weight: 700;
      }
      .label {
        color: #555;
        font-size: 14px;
      }
      .section {
        margin-top: 34px;
        padding-top: 8px;
        border-top: 1px solid #eee;
      }
      code {
        background: #f3f3f3;
        padding: 2px 5px;
        border-radius: 4px;
      }
    "))
  ),
  
  htmltools::tags$body(
    htmltools::tags$h1("IRE 2026 session browser"),
    
    htmltools::tags$p(
      class = "muted",
      paste("Generated", format(Sys.time(), "%Y-%m-%d %I:%M %p %Z"))
    ),
    
    htmltools::tags$p(
      "Source JSON: ",
      htmltools::tags$a(href = schedule_url, schedule_url)
    ),
    
    htmltools::tags$div(
      class = "cards",
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", total_rows),
        htmltools::tags$div(class = "label", "Total schedule rows")
      ),
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", content_sessions),
        htmltools::tags$div(class = "label", "Content sessions")
      ),
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", service_rows),
        htmltools::tags$div(class = "label", "Service / break rows")
      ),
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", total_speakers),
        htmltools::tags$div(class = "label", "Speakers")
      ),
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", total_rooms),
        htmltools::tags$div(class = "label", "Rooms")
      ),
      
      htmltools::tags$div(
        class = "card",
        htmltools::tags$div(class = "metric", total_tracks),
        htmltools::tags$div(class = "label", "Tracks")
      )
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Main session browser"),
      htmltools::tags$p(
        "Use the search box for broad search. Use column filters to narrow by day, room, speaker, track, recording status, or session type. Export buttons are above the table."
      ),
      session_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Summary by day"),
      day_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Tracks"),
      track_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Rooms"),
      room_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Recording status"),
      recording_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Content sessions by room and day"),
      room_day_table
    ),
    
    htmltools::tags$div(
      class = "section",
      htmltools::tags$h2("Speakers by session count"),
      speaker_table
    )
  )
)

# ---- Save HTML ----
htmltools::save_html(
  html = page,
  file = out_html,
  libdir = "ire26_session_browser_files"
)

# Open it locally
browseURL(out_html)
