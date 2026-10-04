import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.data.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import java.io.*;

public class ExportAll extends GhidraScript {
  public void run() throws Exception {
    String out = getScriptArgs()[0];
    // strings with xrefs
    try (PrintWriter pw = new PrintWriter(new FileWriter(out + "/strings.tsv"))) {
      DataIterator dit = currentProgram.getListing().getDefinedData(true);
      while (dit.hasNext()) { Data d = dit.next(); if (!d.hasStringValue()) continue;
        Object v = d.getValue(); if (v == null) continue;
        String s = v.toString().replace("\t","\\t").replace("\n","\\n").replace("\r","\\r");
        StringBuilder xs = new StringBuilder();
        for (Reference r : getReferencesTo(d.getAddress())) {
          Function f = getFunctionContaining(r.getFromAddress());
          xs.append(f == null ? r.getFromAddress().toString() : f.getName()+"@"+r.getFromAddress()).append(",");
        }
        pw.println(d.getAddress() + "\t" + s + "\t" + xs);
      }
    }
    DecompInterface di = new DecompInterface();
    di.openProgram(currentProgram);
    try (PrintWriter pw = new PrintWriter(new FileWriter(out + "/decomp.c"));
         PrintWriter fl = new PrintWriter(new FileWriter(out + "/functions.tsv"))) {
      FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
      int n = 0;
      while (it.hasNext() && !monitor.isCancelled()) {
        Function f = it.next();
        int callers = f.getCallingFunctions(monitor).size();
        int callees = f.getCalledFunctions(monitor).size();
        fl.println(f.getEntryPoint()+"\t"+f.getName()+"\t"+f.getBody().getNumAddresses()+"\t"+callers+"\t"+callees);
        DecompileResults r = di.decompileFunction(f, 60, monitor);
        pw.println("// ==== " + f.getName() + " @ " + f.getEntryPoint() + " callers=" + callers);
        if (r != null && r.decompileCompleted()) pw.println(r.getDecompiledFunction().getC());
        else pw.println("// decompile failed");
        if (++n % 500 == 0) println("decompiled " + n);
      }
    }
  }
}
