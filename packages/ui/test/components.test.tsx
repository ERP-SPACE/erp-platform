import type { ColumnDef } from "@tanstack/react-table";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, DataTable, Money, NumberInput, StatCard } from "../src/index.js";

afterEach(cleanup);

describe("Money", () => {
  it("uses Indian grouping and parentheses for negatives", () => {
    render(<Money value="482300" />);
    expect(screen.getByText("₹ 4,82,300.00")).toBeTruthy();
    render(<Money value="-1200" />);
    expect(screen.getByText("(₹ 1,200.00)").className).toContain("text-danger");
  });
});

describe("Badge and StatCard", () => {
  it("renders a word, not just a colour", () => {
    render(<Badge tone="warning">On hold</Badge>);
    expect(screen.getByText("On hold")).toBeTruthy();
  });

  it("shows the delta direction and value", () => {
    render(
      <StatCard
        label="Sales MTD"
        value="₹ 48.2 L"
        delta={-2.1}
        deltaLabel="vs last month"
        trend={[3, 2, 4, 1]}
      />,
    );
    expect(screen.getByText("2.1%").className).toContain("text-danger");
    expect(screen.getByText("vs last month")).toBeTruthy();
  });
});

describe("NumberInput", () => {
  function Harness() {
    const [value, setValue] = useState("");
    return <NumberInput aria-label="Rate" value={value} onValueChange={setValue} decimals={2} />;
  }

  it("accepts decimals up to the limit and rejects letters or extra places", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Rate") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "12.555" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "12a" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "1,250.75" } });
    expect(input.value).toBe("1250.75");
  });
});

describe("DataTable", () => {
  interface Row {
    id: string;
    name: string;
  }
  const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "Party" }];
  const data: Row[] = [
    { id: "a", name: "Shree Prints" },
    { id: "b", name: "Arihant Tex" },
    { id: "c", name: "Navkar Digital" },
  ];

  it("moves with the arrow keys and opens with Enter", () => {
    const onOpen = vi.fn();
    render(
      <DataTable
        caption="Parties"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={() => {}}
        onOpen={onOpen}
      />,
    );
    const first = screen.getByText("Shree Prints").closest("tr")!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByText("Arihant Tex").closest("tr")!, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(data[1]);
  });

  it("filters with the search box and shows a no-match state", () => {
    render(
      <DataTable
        caption="Parties"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search parties"
      />,
    );
    fireEvent.change(screen.getByLabelText("Search parties"), { target: { value: "navkar" } });
    expect(screen.queryByText("Shree Prints")).toBeNull();
    expect(screen.getByText("Navkar Digital")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search parties"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("paginates", () => {
    render(
      <DataTable
        caption="Parties"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        pageSize={2}
      />,
    );
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Navkar Digital")).toBeTruthy();
  });

  it("shows the empty state", () => {
    render(<DataTable caption="Parties" data={[]} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
  });
});
