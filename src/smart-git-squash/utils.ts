export const wrapText = (text: string, maxLength: number): string => {
  const lines = text.split("\n");
  const wrappedLines = lines.map((line) => {
    if (line.length <= maxLength) return line;

    const words = line.split(" ");
    let currentLine = "";
    const result = [];

    for (const word of words) {
      if ((currentLine + word).length + 1 > maxLength) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }
    if (currentLine) result.push(currentLine);
    return result.join("\n");
  });
  return wrappedLines.join("\n");
};
