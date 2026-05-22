local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local Menu = require("ui/widget/menu")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local json = require("json")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket_url = require("socket.url")

-- Require http/https lazily to avoid startup errors on devices missing ssl
local function getRequester(url)
    if url:match("^https") then
        return require("ssl.https")
    else
        return require("socket.http")
    end
end

local FORMAT_PRIORITY = { epub = 1, mobi = 2, azw3 = 3, fb2 = 4, pdf = 5 }

local BookOrbit = WidgetContainer:extend{
    name = "bookorbit",
}

function BookOrbit:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/bookorbit.lua")
    self.downloaded_ids = {}
    if self.ui and self.ui.menu then
        logger.info("BookOrbit: registering to main menu")
        self.ui.menu:registerToMainMenu(self)
    else
        logger.warn("BookOrbit: no ui.menu available during init, skipping menu registration")
    end

function BookOrbit:addToMainMenu(menu_items)
    menu_items.bookorbit = {
        text = "BookOrbit",
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = "Search Library",
                callback = function()
                    self:ensureAuth(function() self:showSearch() end)
                end,
            },
            {
                text = "Settings",
                callback = function() self:showSettings() end,
            },
        },
    }
end

-- Settings ------------------------------------------------------------------

function BookOrbit:serverUrl()
    return (self.settings:readSetting("server_url") or ""):gsub("/$", "")
end

function BookOrbit:getToken()
    return self.settings:readSetting("token")
end

function BookOrbit:showSettings()
    local dialog
    dialog = MultiInputDialog:new{
        title = "BookOrbit Settings",
        fields = {
            {
                text = self.settings:readSetting("server_url") or "",
                hint = "Server URL (https://bookorbit.example.com)",
            },
            {
                text = self.settings:readSetting("username") or "",
                hint = "Username",
            },
            {
                text = self.settings:readSetting("password") or "",
                hint = "Password",
                text_type = "password",
            },
        },
        buttons = {
            {
                {
                    text = "Cancel",
                    callback = function() UIManager:close(dialog) end,
                },
                {
                    text = "Save & Login",
                    is_enter_default = true,
                    callback = function()
                        local fields = dialog:getFields()
                        local url      = fields[1]:gsub("/%s*$", "")
                        local username = fields[2]
                        local password = fields[3]
                        UIManager:close(dialog)

                        if url == "" or username == "" or password == "" then
                            UIManager:show(InfoMessage:new{ text = "All fields are required." })
                            return
                        end

                        self.settings:saveSetting("server_url", url)
                        self.settings:saveSetting("username", username)
                        self.settings:saveSetting("password", password)
                        self.settings:saveSetting("token", nil)
                        self.settings:flush()

                        self:login(username, password, function(ok, err)
                            if ok then
                                UIManager:show(InfoMessage:new{
                                    text = "Connected to BookOrbit!",
                                    timeout = 2,
                                })
                            else
                                UIManager:show(InfoMessage:new{
                                    text = "Login failed: " .. (err or "unknown error"),
                                })
                            end
                        end)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

-- HTTP helpers --------------------------------------------------------------

function BookOrbit:request(method, path, body_table)
    local url = self:serverUrl() .. path
    local token = self:getToken()

    local headers = {
        ["Accept"] = "application/json",
        ["Content-Type"] = "application/json",
    }
    if token then
        headers["Authorization"] = "Bearer " .. token
    end

    local body_str
    if body_table then
        body_str = json.encode(body_table)
        headers["Content-Length"] = tostring(#body_str)
    end

    local response_chunks = {}
    local requester = getRequester(url)
    local ok, code = requester.request{
        url     = url,
        method  = method,
        headers = headers,
        source  = body_str and ltn12.source.string(body_str) or nil,
        sink    = ltn12.sink.table(response_chunks),
    }

    if not ok then
        logger.warn("BookOrbit: request failed:", code)
        return nil, "Network error: " .. tostring(code), nil
    end

    local body = table.concat(response_chunks)
    local parsed = body ~= "" and json.decode(body) or nil
    return parsed, nil, tonumber(code)
end

-- Auth ----------------------------------------------------------------------

function BookOrbit:login(username, password, callback)
    local url = self:serverUrl()
    if url == "" then
        callback(false, "Server URL not set")
        return
    end

    local data, err, code = self:request("POST", "/api/v1/auth/login", {
        username = username,
        password = password,
    })

    if err then
        callback(false, err)
        return
    end
    if code ~= 200 and code ~= 201 then
        callback(false, "Invalid credentials (HTTP " .. tostring(code) .. ")")
        return
    end

    local token = data and (data.accessToken or data.token)
    if not token then
        callback(false, "No token in server response")
        return
    end

    self.settings:saveSetting("token", token)
    self.settings:flush()
    callback(true, nil)
end

function BookOrbit:ensureAuth(callback)
    if self:serverUrl() == "" then
        self:showSettings()
        return
    end

    if self:getToken() then
        callback()
        return
    end

    -- Token missing — try to re-login with saved credentials
    local username = self.settings:readSetting("username") or ""
    local password = self.settings:readSetting("password") or ""

    if username ~= "" and password ~= "" then
        self:login(username, password, function(ok, err)
            if ok then
                callback()
            else
                UIManager:show(InfoMessage:new{ text = "Re-login failed: " .. (err or "") })
                self:showSettings()
            end
        end)
    else
        self:showSettings()
    end
end

function BookOrbit:handleUnauthorized()
    self.settings:saveSetting("token", nil)
    self.settings:flush()
    UIManager:show(InfoMessage:new{ text = "Session expired. Open BookOrbit → Settings to reconnect." })
end

-- Search --------------------------------------------------------------------

function BookOrbit:showSearch()
    local dialog
    dialog = InputDialog:new{
        title = "Search BookOrbit",
        input_hint = "Title or author...",
        buttons = {
            {
                {
                    text = "Cancel",
                    callback = function() UIManager:close(dialog) end,
                },
                {
                    text = "Search",
                    is_enter_default = true,
                    callback = function()
                        local q = dialog:getInputText()
                        UIManager:close(dialog)
                        if q and q:match("%S") then
                            self:doSearch(q)
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbit:doSearch(q)
    UIManager:show(InfoMessage:new{ text = "Searching...", timeout = 1 })

    local path = "/api/v1/books/search?q=" .. socket_url.escape(q) .. "&limit=20"
    local data, err, code = self:request("GET", path, nil)

    if code == 401 then
        self:handleUnauthorized()
        return
    end
    if err or not data then
        UIManager:show(InfoMessage:new{ text = "Search failed: " .. (err or "no response") })
        return
    end
    if #data == 0 then
        UIManager:show(InfoMessage:new{ text = "No results found.", timeout = 2 })
        return
    end

    self:showResults(data)
end

function BookOrbit:safeTitle(title)
    return (title or "book"):gsub('[/\\:*?"<>|%%]', "_")
end

function BookOrbit:bookExistsOnDevice(title, formats)
    local home_dir = G_reader_settings:readSetting("home_dir") or "/mnt/us/documents"
    local safe = self:safeTitle(title)
    local exts = (formats and #formats > 0) and formats or { "epub", "mobi", "azw3", "fb2", "pdf" }
    for _, ext in ipairs(exts) do
        local path = home_dir .. "/" .. safe .. "." .. ext:lower()
        local f = io.open(path, "r")
        if f then
            f:close()
            return true
        end
    end
    return false
end

function BookOrbit:buildResultItems(books)
    local item_table = {}

    -- "New Search" at the top
    table.insert(item_table, {
        text = "[ New Search ]",
        bold = true,
        is_new_search = true,
    })

    for _, book in ipairs(books) do
        local author_str = table.concat(book.authors or {}, ", ")
        local fmt_str    = table.concat(book.formats or {}, " · "):upper()
        local label = book.title or "(Untitled)"
        if self.downloaded_ids[tostring(book.id)] or self:bookExistsOnDevice(book.title, book.formats) then
            label = "✓ " .. label
        end
        table.insert(item_table, {
            text      = label,
            mandatory = fmt_str ~= "" and fmt_str or nil,
            book_id   = book.id,
            book_title = book.title or "book",
            book_data  = book,
        })
    end

    return item_table
end

function BookOrbit:showResults(books)
    -- Reset downloaded tracking for a fresh search session
    self.downloaded_ids = {}
    self.current_books = books

    local item_table = self:buildResultItems(books)

    self.results_menu = Menu:new{
        title      = "BookOrbit Results",
        item_table = item_table,
        onMenuSelect = function(_, item)
            if item.is_new_search then
                UIManager:close(self.results_menu)
                self.results_menu = nil
                self:showSearch()
                return
            end
            -- Don't close the menu — keep it open for multiple downloads
            self:selectBook(item, function()
                -- Mark as downloaded and refresh the list
                self.downloaded_ids[tostring(item.book_id)] = true
                local new_items = self:buildResultItems(self.current_books)
                self.results_menu:switchItemTable("BookOrbit Results", new_items)
            end)
        end,
    }
    UIManager:show(self.results_menu)
end

-- Download ------------------------------------------------------------------

function BookOrbit:selectBook(item, on_success)
    -- If we have cover/format info in book_data, show detail view
    -- Otherwise fall back to fetching from API
    local book_data = item.book_data
    if book_data and book_data.files and #book_data.files > 0 then
        self:handleBookFiles(book_data.files, item.book_title, book_data.cover, on_success)
        return
    end

    UIManager:show(InfoMessage:new{ text = "Loading book info...", timeout = 1 })

    local data, err, code = self:request("GET", "/api/v1/books/" .. item.book_id, nil)

    if code == 401 then
        self:handleUnauthorized()
        return
    end
    if err or not data then
        UIManager:show(InfoMessage:new{ text = "Failed to load book: " .. (err or "") })
        return
    end

    local cover_url = data.cover or nil
    self:handleBookFiles(data.files or {}, item.book_title, cover_url, on_success)
end

function BookOrbit:handleBookFiles(files, title, cover_url, on_success)
    -- Filter to ebook formats only (skip audio)
    local ebook_files = {}
    for _, f in ipairs(files) do
        if FORMAT_PRIORITY[f.format] then
            table.insert(ebook_files, f)
        end
    end

    if #ebook_files == 0 then
        UIManager:show(InfoMessage:new{ text = "No downloadable ebook file found." })
        return
    end

    -- Sort by priority (epub first)
    table.sort(ebook_files, function(a, b)
        return (FORMAT_PRIORITY[a.format] or 99) < (FORMAT_PRIORITY[b.format] or 99)
    end)

    if #ebook_files == 1 then
        self:showBookDetail(ebook_files[1], title, cover_url, on_success)
    else
        self:pickFormat(ebook_files, title, cover_url, on_success)
    end
end

function BookOrbit:pickFormat(files, title, cover_url, on_success)
    local item_table = {}
    for _, f in ipairs(files) do
        table.insert(item_table, {
            text = (f.format or "?"):upper(),
            file = f,
        })
    end

    local fmt_menu
    fmt_menu = Menu:new{
        title = "Choose Format",
        item_table = item_table,
        onMenuSelect = function(_, item)
            UIManager:close(fmt_menu)
            self:showBookDetail(item.file, title, cover_url, on_success)
        end,
    }
    UIManager:show(fmt_menu)
end


function BookOrbit:showBookDetail(file, title, cover_url, on_success)
    local ConfirmBox = require("ui/widget/confirmbox")
    local ext = (file.format or "epub"):upper()
    UIManager:show(ConfirmBox:new{
        text        = (title or "(Untitled)") .. "\n\n" .. ext,
        ok_text     = "Download",
        cancel_text = "Cancel",
        ok_callback = function()
            self:downloadFile(file, title, on_success)
        end,
    })
end

function BookOrbit:downloadFile(file, title, on_success)
    local ext        = file.format or "epub"
    local safe_title = self:safeTitle(title)
    local home_dir   = G_reader_settings:readSetting("home_dir") or "/mnt/us/documents"
    local dest_path  = home_dir .. "/" .. safe_title .. "." .. ext

    -- Show persistent loading indicator (no timeout)
    local loading = InfoMessage:new{
        text = "Downloading…\n\n" .. safe_title .. "." .. ext,
    }
    UIManager:show(loading)
    UIManager:forceRePaint()

    local url     = self:serverUrl() .. "/api/v1/books/files/" .. file.id .. "/download"
    local token   = self:getToken()
    local headers = {
        ["Authorization"] = "Bearer " .. (token or ""),
        ["Accept"]        = "*/*",
    }

    local f, open_err = io.open(dest_path, "wb")
    if not f then
        UIManager:close(loading)
        UIManager:show(InfoMessage:new{
            text = "Cannot write file: " .. (open_err or dest_path),
        })
        return
    end

    local requester = getRequester(url)
    local ok, code  = requester.request{
        url     = url,
        method  = "GET",
        headers = headers,
        sink    = ltn12.sink.file(f),
    }
    -- ltn12.sink.file closes the file automatically

    UIManager:close(loading)

    if not ok or (tonumber(code) ~= 200 and tonumber(code) ~= 206) then
        os.remove(dest_path)
        if tonumber(code) == 401 then
            self:handleUnauthorized()
        else
            UIManager:show(InfoMessage:new{
                text = "Download failed (HTTP " .. tostring(code) .. ")",
            })
        end
        return
    end

    -- Force full e-ink refresh to clear artifacts
    UIManager:setDirty("all", "full")

    -- Refresh file manager so the book appears immediately
    local ok_fm, FileManager = pcall(require, "apps/filemanager/filemanager")
    if ok_fm and FileManager.instance then
        local fc = FileManager.instance.file_chooser
        if fc and fc.refreshPath then
            fc:refreshPath()
        else
            FileManager.instance:onRefresh()
        end
    end

    UIManager:show(InfoMessage:new{
        text    = "Done!\n\n" .. safe_title .. "." .. ext .. "\nSaved to " .. home_dir,
        timeout = 3,
    })

    -- Notify caller (e.g. to mark as downloaded in results list)
    if on_success then
        on_success()
    end
end

return BookOrbit
