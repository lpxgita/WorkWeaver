-- 获取当前焦点窗口的应用名称和窗口标题
-- 返回格式: JSON 字符串 {"app":"应用名","title":"窗口标题"}

use scripting additions

set outputApp to ""
set outputTitle to ""

try
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set outputApp to name of frontApp
        -- 策略1: 通过 AXMain 属性获取主窗口标题
        try
            tell process outputApp
                tell (1st window whose value of attribute "AXMain" is true)
                    set outputTitle to value of attribute "AXTitle"
                end tell
            end tell
        on error
            -- 策略2: 获取第一个窗口的 AXTitle
            try
                tell process outputApp
                    set outputTitle to value of attribute "AXTitle" of window 1
                end tell
            on error
                -- 策略3: 获取第一个窗口的 name
                try
                    tell process outputApp
                        set outputTitle to name of window 1
                    end tell
                on error
                    -- 策略4: 尝试获取聚焦的 UI 元素描述
                    try
                        tell process outputApp
                            set outputTitle to description of (first UI element whose role is "AXWindow")
                        end tell
                    on error
                        set outputTitle to ""
                    end try
                end try
            end try
        end try
    end tell
on error errMsg
    return "{\"app\":\"\",\"title\":\"\",\"error\":\"" & errMsg & "\"}"
end try

-- 手动转义 JSON 特殊字符
set outputApp to my escapeJSON(outputApp)
set outputTitle to my escapeJSON(outputTitle)

return "{\"app\":\"" & outputApp & "\",\"title\":\"" & outputTitle & "\"}"

-- JSON 转义函数
on escapeJSON(theText)
    set resultText to ""
    repeat with i from 1 to length of theText
        set theChar to character i of theText
        if theChar is "\"" then
            set resultText to resultText & "\\\""
        else if theChar is "\\" then
            set resultText to resultText & "\\\\"
        else
            set resultText to resultText & theChar
        end if
    end repeat
    return resultText
end escapeJSON
