export type ReadState = "read" | "unread" | "requested" | "unavailable";

export function ReadStatus({
  state,
  newer = false,
}: {
  state?: ReadState;
  newer?: boolean;
}) {
  if (!state) return null;

  const label = {
    read: "Read",
    unread: "Unread",
    requested: "Requested guide",
    unavailable: "Guide unavailable",
  }[state];

  return (
    <p className="text-xs text-muted-foreground">
      {label}
      {state === "read" && newer ? " · Newer revision available" : ""}
    </p>
  );
}
