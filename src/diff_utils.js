/**
 * 解析 diff 中的新增行映射
 * @param {string} diffText - diff文本内容
 * @returns {Array<[number, number]>} - [diff中的行号, 新文件中的行号]
 * 
 * 工作原理:
 * 1. 遍历diff的每一行
 * 2. 遇到@@ 标记时，提取新文件的起始行号
 * 3. 对于新增行(+开头)，记录映射关系
 * 4. 对于上下文行和旧文件行，更新行号计数器
 */
function parseDiffNewlineMap(diffText) {
    const diffLines = diffText.split('\n');
    const mapping = [];
    let currentNewLine = -1;

    for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];

        // 解析hunk头，获取新文件起始行号
        if (line.startsWith('@@')) {
            const match = /@@ -\d+(,\d+)? \+(\d+)(,\d+)? @@/.exec(line);
            if (match && match[2]) {
                currentNewLine = parseInt(match[2], 10);
            }
        } 
        // 新增行：记录映射
        else if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentNewLine !== -1) {
                mapping.push([i + 1, currentNewLine]); // diff行号从1开始
                currentNewLine++;
            }
        } 
        // 上下文行或旧文件删除行：更新行号
        else if (!line.startsWith('-') || line.startsWith('---')) {
            if (currentNewLine !== -1) {
                currentNewLine++;
            }
        }
    }
    return mapping;
}

/**
 * 分割 diff 中的 hunks
 */
function splitHunks(diffText) {
    const lines = diffText.split('\n');
    const hunks = [];
    let currentHunk = {
        oldStart: 0,
        newStart: 0,
        hunkLines: []
    };
    let inHunk = false; // 标记是否已经进入 hunk

    lines.forEach(line => {
        // 跳过文件头（diff --git, ---, +++, index 等）
        if (!inHunk && (
            line.startsWith('diff --git') || 
            line.startsWith('---') || 
            line.startsWith('+++') || 
            line.startsWith('index ') ||
            line.startsWith('new file ') ||
            line.startsWith('deleted file ')
        )) {
            return; // 跳过这些行
        }

        if (line.startsWith('@@')) {
            inHunk = true; // 标记进入 hunk
            const match = line.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
            if (currentHunk.hunkLines.length) {
                hunks.push(currentHunk);
                currentHunk = {
                    oldStart: 0,
                    newStart: 0,
                    hunkLines: []
                };
            }

            if (match) {
                currentHunk.oldStart = parseInt(match[1], 10);
                currentHunk.newStart = parseInt(match[3], 10);
            }
        }

        // 只有在 hunk 内才添加行
        if (inHunk) {
            currentHunk.hunkLines.push(line);
        }
    });

    if (currentHunk.hunkLines.length) {
        hunks.push(currentHunk);
    }

    return hunks;
}

/**
 * 计算 hunk 中的精确行号
 */
function computeHunkLineNumbers(hunk) {
    const { oldStart, newStart, hunkLines } = hunk;
    const temp = [];
    const newHunkLines = [hunkLines[0]];
    let maxHeaderLength = 0;
    const oldLinesMap = new Map();
    const newLinesMap = new Map();

    let oldLineNumber = oldStart;
    let newLineNumber = newStart;

    hunkLines.slice(1).forEach(line => {
        let header = '';
        if (line.startsWith('-')) {
            // 删除行：只影响旧文件行号
            header = `(${oldLineNumber}, )`;
            temp.push([header, line]);
            oldLinesMap.set(oldLineNumber, line);
            oldLineNumber++;
            maxHeaderLength = Math.max(maxHeaderLength, header.length);
        } else if (line.startsWith('+')) {
            // 添加行：只影响新文件行号
            header = `( , ${newLineNumber})`;
            temp.push([header, line]);
            newLinesMap.set(newLineNumber, line);
            newLineNumber++;
            maxHeaderLength = Math.max(maxHeaderLength, header.length);
        } else {
            // 上下文行：同时影响新旧文件行号
            header = `(${oldLineNumber}, ${newLineNumber})`;
            temp.push([header, line]);
            oldLinesMap.set(oldLineNumber, line);
            newLinesMap.set(newLineNumber, line);
            oldLineNumber++;
            newLineNumber++;
            maxHeaderLength = Math.max(maxHeaderLength, header.length);
        }
    });

    temp.forEach(([header, line]) => {
        newHunkLines.push(`${header.padEnd(maxHeaderLength)} ${line}`);
    });

    return { newHunkLines, newLinesMap, oldLinesMap };
}

/**
 * 为 diff 添加行号标记
 */
function addLineNumbersToDiff(diffText) {
    const hunks = splitHunks(diffText);
    const allNewLinesMap = new Map();
    const allOldLinesMap = new Map();
    const extendedDiffParts = [];

    hunks.forEach(hunk => {
        const { newHunkLines, newLinesMap, oldLinesMap } = computeHunkLineNumbers(hunk);
        extendedDiffParts.push(newHunkLines.join('\n'));
        
        // 合并所有行号映射
        newLinesMap.forEach((line, lineNum) => allNewLinesMap.set(lineNum, line));
        oldLinesMap.forEach((line, lineNum) => allOldLinesMap.set(lineNum, line));
    });

    return {
        extendedDiff: extendedDiffParts.join('\n'),
        newLinesMap: allNewLinesMap,
        oldLinesMap: allOldLinesMap
    };
}

module.exports = {
    parseDiffNewlineMap,
    addLineNumbersToDiff,
};
