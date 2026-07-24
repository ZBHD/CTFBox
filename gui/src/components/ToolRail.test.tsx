import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ToolRail } from "./ToolRail";

const baseProps = {
  selection: { toolId: "sqlmap" },
  settingsOpen: false,
  onSelect: () => undefined,
  onOpenSettings: () => undefined,
};

describe("ToolRail", () => {
  it("opens the available update from the brand area", () => {
    const onOpenUpdate = vi.fn();
    const rail = create(
      <ToolRail
        {...baseProps}
        availableUpdateVersion="0.2.0"
        onOpenUpdate={onOpenUpdate}
      />,
    );
    const updateButton = rail.root.findByProps({
      "aria-label": "发现新版本 v0.2.0",
      title: "发现新版本 v0.2.0",
    });

    act(() => updateButton.props.onClick());

    expect(onOpenUpdate).toHaveBeenCalledOnce();
  });

  it("hides the update button when no update is available", () => {
    const rail = create(<ToolRail {...baseProps} onOpenUpdate={() => undefined} />);

    expect(
      rail.root.findAll((node) =>
        String(node.props["aria-label"] ?? "").startsWith("发现新版本 v"),
      ),
    ).toHaveLength(0);
  });
});
