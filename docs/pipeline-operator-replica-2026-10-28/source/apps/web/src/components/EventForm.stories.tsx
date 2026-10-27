import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EventForm } from "./EventForm";

const meta = {
  title: "Flywheel/EventForm",
  component: EventForm,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div className="w-[min(70rem,95vw)]"><Story /></div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof EventForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { csrfToken: "storybook-csrf-token" } };
