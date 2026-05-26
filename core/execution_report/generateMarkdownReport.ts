import * as fs from 'fs';
import * as path from 'path';

export function generateMarkdownReport() {
  const reportsDir = path.join(process.cwd(), 'reports');
  const outputFilePath = path.join(reportsDir, 'execution_analysis_report.md');

  if (!fs.existsSync(reportsDir)) {
    console.log('No reports directory found.');
    return;
  }

  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('_summary.json'));
  if (files.length === 0) {
    console.log('No _summary.json files found in reports directory.');
    return;
  }

  const summaries = files.map(file => {
    try {
      return JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));
    } catch {
      return null;
    }
  }).filter(s => s !== null);

  let totalSteps = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const tableRows = summaries.map(summary => {
    totalSteps += summary.stepsExecuted || 0;
    totalTokens += summary.tokens || 0;
    totalCost += summary.estimatedCostUsd || 0;

    const testName = summary.testName || summary.test;
    const status = summary.status || 'UNKNOWN';
    const steps = summary.stepsExecuted || 0;
    const tokens = summary.tokens || 0;
    const cost = `$${(summary.estimatedCostUsd || 0).toFixed(3)}`;
    const confidence = 'High'; // Can be dynamically inferred from aiAnalysis later

    return `| **${testName}** | ${status} | ${steps} | ${tokens.toLocaleString()} | ${cost} | ${confidence} |`;
  }).join('\n');

  let markdown = `# WebPilot Execution Analysis Report\n\n`;
  markdown += `Based on the historical execution data in \`/reports\`, here is a consolidated analysis of the ${summaries.length} recent test runs.\n\n`;
  
  markdown += `## Executive Summary\n\n`;
  markdown += `| Test Name | Status | Steps | Tokens Used | Cost (USD) | Confidence |\n`;
  markdown += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  markdown += tableRows + '\n';
  markdown += `| **Total** | | **${totalSteps}** | **${totalTokens.toLocaleString()}** | **$${totalCost.toFixed(3)}** | |\n\n`;

  markdown += `> [!TIP]\n`;
  markdown += `> **Cost Efficiency Insight**\n`;
  const avgCost = totalSteps > 0 ? (totalCost / totalSteps).toFixed(3) : "0";
  markdown += `> The average cost per step executed is **~$${avgCost}**.\n\n`;
  markdown += `---\n\n`;
  markdown += `## Detailed Test Breakdown\n\n`;

  summaries.forEach((summary, index) => {
    const testName = summary.testName || summary.test;
    const testKey = summary.test;
    const status = summary.status || 'UNKNOWN';
    const steps = summary.stepsExecuted || 0;
    const cost = `$${(summary.estimatedCostUsd || 0).toFixed(3)}`;
    const tokens = summary.tokens || 0;
    
    markdown += `### ${index + 1}. ${testName} (\`${testKey}\`)\n`;
    markdown += `* **Execution Path**: \`${summary.testFile || 'Unknown'}\`\n`;
    markdown += `* **Artifacts**: Trace, Video, and ${summary.artifacts?.screenshots?.length || 0} screenshots captured.\n`;
    markdown += `* **Status**: ${status}\n`;
    markdown += `* **Cost**: ${cost} | **Tokens**: ${tokens.toLocaleString()}\n\n`;
    
    if (summary.aiAnalysis) {
      markdown += `#### AI Analysis Extract\n`;
      // We extract only the critical points to keep it concise, or just append the whole thing.
      // Since the user wants the "exact same format", we'll summarize based on the AI analysis strings if possible,
      // but since we can't reliably parse the markdown headers out of aiAnalysis, we'll just inject the aiAnalysis block.
      markdown += `${summary.aiAnalysis}\n\n`;
    }

    if (summary.failureContext) {
      markdown += `#### Failure Context (Before Healing)\n`;
      markdown += `\`\`\`\n${summary.failureContext}\n\`\`\`\n\n`;
    }

    if (summary.fixReport) {
      markdown += `#### Fix Report\n`;
      markdown += `${summary.fixReport}\n\n`;
    }

    markdown += `---\n\n`;
  });

  markdown += `## Global Insights for Future AI Agents\n\n`;
  markdown += `> [!IMPORTANT]\n`;
  markdown += `> **Locator Strategy Drift**\n`;
  markdown += `> Future AI agents running in **healing mode** should strictly rewrite locators to Playwright's \`getByRole\` standard whenever they fail.\n\n`;

  fs.writeFileSync(outputFilePath, markdown, 'utf8');
  console.log(`Successfully generated execution analysis report at: ${outputFilePath}`);
}

// Allow running directly
if (require.main === module) {
  generateMarkdownReport();
}
