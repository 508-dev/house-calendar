import { createFileRoute } from "@tanstack/react-router";
import {
  buildSampleScenario,
  exampleHouseConfig,
} from "@/lib/house/sample-data";

export const Route = createFileRoute("/api/demo")({
  server: {
    handlers: {
      GET: () => {
        const { sampleDerivedDays, sampleEventInterpretations } =
          buildSampleScenario();

        return Response.json({
          availability: sampleDerivedDays,
          events: sampleEventInterpretations,
          house: exampleHouseConfig,
        });
      },
    },
  },
});
