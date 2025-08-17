// components/Screen.tsx
import React, { ReactNode } from 'react';
import { Platform, KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  scroll?: boolean;                 // true = ScrollView (par défaut)
  style?: any;
  contentStyle?: any;
};

export default function Screen({ children, scroll = true, style, contentStyle }: Props) {
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: '#000' }, style]} edges={['top','left','right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[{ padding: 16, paddingBottom: 32 }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="always"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, padding: 16 }, contentStyle]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
