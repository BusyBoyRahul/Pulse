import React, {useEffect, useState} from 'react';
import {Alert, FlatList, Pressable, StyleSheet, View} from 'react-native';
import {Screen, Button, Txt, Card, TextField, MaskedNumber} from '@/components';
import {colors, radius, spacing} from '@/theme/theme';
import {useContactsStore} from '@/store/contactsStore';
import type {TrustedContact} from '@/types';

const MAX = 5;

export default function TrustedCircleScreen() {
  const {contacts, hydrate, add, remove} = useContactsStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+1');
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const atCap = contacts.length >= MAX;

  const submit = () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Add a name.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setFormError('Enter a valid number with country code, e.g. +15551234567.');
      return;
    }
    if (contacts.some(c => c.phoneNumber === phone.trim())) {
      setFormError('That number is already in your circle.');
      return;
    }
    add(name.trim(), phone.trim());
    setName('');
    setPhone('+1');
    setAdding(false);
  };

  const confirmRemove = (c: TrustedContact) => {
    Alert.alert('Remove contact', `Remove ${c.name} from your trusted circle?`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Remove', style: 'destructive', onPress: () => remove(c)},
    ]);
  };

  const renderItem = ({item}: {item: TrustedContact}) => (
    <Card style={styles.row}>
      <View style={styles.avatar}>
        <Txt variant="subtitle" tone="accent">
          {item.name.charAt(0).toUpperCase()}
        </Txt>
      </View>
      <View style={styles.rowText}>
        <Txt variant="bodyStrong">{item.name}</Txt>
        <MaskedNumber value={item.phoneNumber} />
      </View>
      <Pressable hitSlop={12} onPress={() => confirmRemove(item)}>
        <Txt variant="caption" tone="danger">
          Remove
        </Txt>
      </Pressable>
    </Card>
  );

  return (
    <Screen padded={false} edges={['left', 'right']} bottomClear={false}>
      <FlatList
        data={contacts}
        keyExtractor={c => c.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Txt variant="body" tone="secondary">
              If you send an SOS, these people get a text from this phone's SIM with your
              name and location. Add up to {MAX}.
            </Txt>
            <Txt variant="label" tone="muted" style={styles.count}>
              {contacts.length}/{MAX} ADDED
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <Card style={styles.empty} raised>
            <Txt variant="subtitle">No contacts yet</Txt>
            <Txt variant="caption" tone="muted" style={styles.emptyBody}>
              Add at least one person so an SOS has somewhere to go.
            </Txt>
          </Card>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {adding ? (
              <Card raised>
                <TextField
                  label="Name"
                  placeholder="Jordan"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />
                <TextField
                  label="Phone number"
                  placeholder="+15551234567"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
                {formError ? (
                  <Txt variant="caption" tone="danger" style={styles.err}>
                    {formError}
                  </Txt>
                ) : null}
                <Button label="Save contact" onPress={submit} />
                <Button label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
              </Card>
            ) : (
              <Button
                label={atCap ? 'Circle full' : '+ Add trusted contact'}
                variant="secondary"
                disabled={atCap}
                onPress={() => setAdding(true)}
              />
            )}
            <Txt variant="caption" tone="muted" style={styles.syncErr}>
              Numbers are encrypted on this phone and hidden until you tap the eye. They are
              only used to send your SOS text — never shared over the mesh or in calls.
            </Txt>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {padding: spacing.xl, paddingBottom: spacing.xxxl},
  header: {marginBottom: spacing.lg},
  count: {marginTop: spacing.md},
  row: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md},
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowText: {flex: 1},
  empty: {alignItems: 'center', paddingVertical: spacing.xl},
  emptyBody: {marginTop: spacing.xs, textAlign: 'center'},
  footer: {marginTop: spacing.md},
  err: {marginBottom: spacing.sm},
  syncErr: {marginTop: spacing.md, textAlign: 'center'},
});
