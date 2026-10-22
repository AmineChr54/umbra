using System.IO.Pipes;
using System.Text.Json.Nodes;

namespace Umbra.Tests;

/// <summary>
/// The control pipe end to end with the same options the app uses (CurrentUserOnly). On Linux .NET runs named pipes
/// over Unix domain sockets and checks the peer's uid, so this also proves the "current user only" invariant there.
/// </summary>
public class ProtocolPipeTests
{
    [Fact]
    public async Task A_request_round_trips_over_a_current_user_pipe()
    {
        var name = $"umbra-test-{Guid.NewGuid():N}"[..24];
        using var server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        var serve = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync();
            using var reader = new StreamReader(server, leaveOpen: true);
            var line = await reader.ReadLineAsync();
            var cmd = JsonNode.Parse(line!)!["cmd"]!.GetValue<string>();
            await using var writer = new StreamWriter(server, leaveOpen: true) { AutoFlush = true };
            await writer.WriteLineAsync(Protocol.Ok(new JsonObject { ["echo"] = cmd }).ToJsonString());
        });

        var reply = await Protocol.SendAsync(Protocol.Request("status"), connectTimeoutMs: 5000, pipeName: name);
        await serve;

        Assert.True(reply["ok"]!.GetValue<bool>());
        Assert.Equal("status", reply["result"]!["echo"]!.GetValue<string>());
    }

    [Fact]
    public async Task Nobody_listening_times_out()
    {
        await Assert.ThrowsAsync<TimeoutException>(() =>
            Protocol.SendAsync(Protocol.Request("status"), connectTimeoutMs: 200, pipeName: $"umbra-none-{Guid.NewGuid():N}"[..24]));
    }
}
