// Logger.tsx
import React from 'react';
import { View, Text, ScrollView } from 'react-native';

export default function Logger({ logs }: { logs: string[] }) {
  return (
    <View style={{ padding: 10, backgroundColor: 'black', height: 200 }}>
      <ScrollView>
        {logs.map((log, index) => (
          <Text key={index} style={{ color: 'lime', fontSize: 12 }}>
            {log}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
