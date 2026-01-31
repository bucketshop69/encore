import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderJavaScriptVisitor } from "@codama/renderers";
import { visit } from "@codama/visitors-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  try {
    // 1. Load the IDL
    // Note: process.cwd() when running via 'npx tsx scripts/create-codama-client.ts' from 'app'
    // will be 'app'. So '../target' is correct.
    const idlPath = join(process.cwd(), "../target/idl/encore.json");
    console.log(`Loading IDL from: ${idlPath}`);
    
    const idlContent = readFileSync(idlPath, "utf-8");
    const idl = JSON.parse(idlContent);

    // 2. Parse IDL to Codama Node
    const node = rootNodeFromAnchor(idl);

    // 3. Configure Output Directory
    const clientDir = join(process.cwd(), "src/client");
    console.log(`Generating client to: ${clientDir}`);

    // 4. Generate Client
    // renderJavaScriptVisitor returns a visitor that writes files to the provided directory
    const visitor = renderJavaScriptVisitor(clientDir, {
      formatCode: true, // Use default formatting
      deleteHiddenAccounts: true, // Clean up internal accounts if needed
    });

    // Use visit function from visitors-core
    await visit(node, visitor);

    console.log("Client generation complete!");
  } catch (error) {
    console.error("Error generating client:", error);
    process.exit(1);
  }
}

main();
